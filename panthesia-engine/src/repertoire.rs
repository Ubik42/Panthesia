//! Background-only repertoire migration and explicit musical-work relationships.
use crate::{Command, Engine, library_workspace::Workspace, preferences::Preferences};
use panthesia_core::{repertoire::*, utils::atomic_file};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepertoireView {
    pub registry: RepertoireRegistry,
    pub revision: String,
    pub notation_statuses: BTreeMap<String, String>,
    pub project:Option<panthesia_core::song_project::SongProject>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RepertoireEdit {
    pub expected: String,
    pub content_id: String,
    pub work_id: Option<String>,
    pub title: Option<String>,
    pub composer: Option<String>,
    pub catalogue: Option<String>,
    pub notation_id: Option<String>,
    pub quality: Option<ScoreQuality>,
    pub source: Option<String>,
}
pub(crate) fn read(data: &Path) -> Result<(RepertoireRegistry, String), String> {
    let bytes = match atomic_file::read_limited(&data.join("repertoire.json"), 64_000_000) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(e) => return Err(format!("作品资料读取失败：{e}")),
    };
    let registry = if bytes.is_empty() {
        RepertoireRegistry::default()
    } else {
        serde_json::from_slice::<RepertoireRegistry>(&bytes)
            .map_err(|e| format!("作品资料格式无效，原文件保留：{e}"))?
    };
    registry.validate()?;
    Ok((registry, blake3::hash(&bytes).to_hex().to_string()))
}
fn migrate(
    registry: &mut RepertoireRegistry,
    data: &Path,
    path: Option<&Path>,
    content: Option<&str>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<(), String> {
    let workspace = Workspace::load(data)?;
    let prefs = Preferences::load(&data.join("web-preferences.json"))?;
    let history = panthesia_core::practice_history::PracticeHistoryStore::load_snapshot(
        data.join("web-practice-history.ron"),
    )?;
    for (id, song) in history.iter_songs() {
        check()?;
        let location = song.library.source_path.as_ref().or_else(|| {
            song.setup
                .as_ref()
                .and_then(|setup| setup.source_path.as_ref())
        });
        registry.register(
            id,
            &song.display_name,
            "",
            location.map(|p| p.to_string_lossy().into_owned()),
        );
    }
    for entry in workspace
        .entries
        .values()
        .chain(workspace.retired_entries.values())
    {
        check()?;
        if let Some(id) = &entry.content_id {
            registry.register(
                id,
                entry.metadata.title.as_deref().unwrap_or("未命名作品"),
                entry.metadata.composer.as_deref().unwrap_or(""),
                Some(entry.path.to_string_lossy().into_owned()),
            );
        }
    }
    for id in prefs.songs.keys().chain(prefs.score_versions.keys()) {
        registry.register(
            id,
            if prefs.last_content_id.as_deref() == Some(id) {
                &prefs.title
            } else {
                "未命名作品"
            },
            "",
            None,
        );
    }
    if let (Some(path), Some(content)) = (path, content) {
        check()?;
        let file = midi_file::MidiFile::new(path)?;
        if file.content_id != content {
            return Err("文件内容已变化，请重新检查后管理作品".into());
        }
        let entry = workspace
            .entries
            .values()
            .find(|entry| entry.content_id.as_deref() == Some(content));
        let metadata = panthesia_core::library::load_song_sidecar(path, content)
            .map(|sidecar| sidecar.metadata)
            .unwrap_or_default();
        let title = metadata
            .title
            .as_deref()
            .or_else(|| entry.and_then(|e| e.metadata.title.as_deref()))
            .unwrap_or_else(|| {
                path.file_stem()
                    .and_then(|s| s.to_str())
                    .unwrap_or("未命名作品")
            });
        let composer = metadata.composer.as_deref().unwrap_or("");
        registry.register(
            content,
            title,
            composer,
            Some(path.to_string_lossy().into_owned()),
        );
        // Upgrade the placeholder only; explicit work metadata remains user-owned.
        let work_id = &registry.performances[content].work_id;
        if let Some(work) = registry.works.get_mut(work_id) {
            if work.title == "未命名作品" {
                work.title = title.into();
                work.composer = composer.into();
            }
        }
    }
    let mut score_versions = prefs.score_versions.materialize();
    if let (Some(path), Some(content)) = (path, content) {
        score_versions.insert(
            content.into(),
            crate::library_scores::versions(&prefs, path, content)?.0,
        );
    }
    for notation in registry.notations.values_mut() {
        if score_versions.contains_key(&notation.performance_id) {
            notation.registered = false;
        }
    }
    let needs_origins = score_versions.iter().any(|(performance, versions)| {
        versions.iter().any(|v| {
            !registry
                .notations
                .contains_key(&format!("{performance}:{}", v.id))
        })
    });
    let automatic_origins = if needs_origins {
        crate::notation_drafts::automatic_origins(data, check)?
    } else {
        BTreeMap::new()
    };
    let registered_origins = if needs_origins {
        crate::score_sources::registered_origins(data)?
    } else {
        BTreeMap::new()
    };
    for (performance, versions) in &score_versions {
        for version in versions {
            check()?;
            let id = format!("{performance}:{}", version.id);
            let builtin =
                crate::library::is_builtin_notation(data, &version.path, &version.content_id);
            let automatic = automatic_origins.get(&version.content_id);
            let original =
                registered_origins.get(&(performance.clone(), version.content_id.clone()));
            let notation = registry.notations.entry(id.clone()).or_insert_with(|| NotationEdition { id, content_id: version.content_id.clone(), performance_id: performance.clone(), version_id: version.id.clone(), name: version.name.clone(), path: version.path.to_string_lossy().into_owned(), quality: if builtin || automatic.is_some() { ScoreQuality::AutomaticDraft } else if original.is_some() { ScoreQuality::Original } else { ScoreQuality::Unreviewed }, source: if builtin { "内置原创配对谱；音高与起音 tick 已核对，MIDI 松键时序单独保留；教学指法与排版待人工校对".into() } else { automatic.or(original).cloned().unwrap_or_default() }, registered: true });
            // A changed score never inherits the review status of its predecessor.
            if notation.content_id != version.content_id {
                notation.quality = ScoreQuality::Unreviewed;
            }
            notation.content_id = version.content_id.clone();
            notation.name = version.name.clone();
            notation.path = version.path.to_string_lossy().into_owned();
            notation.registered = true;
        }
    }
    registry.validate()
}
fn bounded(value: String, limit: usize) -> Result<String, String> {
    let value = value.trim();
    if value.chars().count() > limit || value.chars().any(|c| c.is_control() && c != '\n') {
        return Err("作品文字过长或含无效字符".into());
    }
    Ok(value.into())
}
impl Engine {
    pub(super) fn repertoire_task(&self, command: Command) -> Result<serde_json::Value, String> {
        let engine = self.clone();
        let operation = self.pending_operation()?;
        self.storage_tasks
            .run("整理作品与谱面资料", None, move |token| {
                let _operation = operation;
                engine.pending_saves.flush()?;
                token.stage("readingLibrary")?;
                if let Command::InspectNotation {
                    path,
                    content_id,
                    version_id,
                } = command
                {
                    let file = midi_file::MidiFile::new(&path)?;
                    if file.content_id != content_id {
                        return Err("演奏文件已变化，请刷新后检查乐谱".into());
                    }
                    let prefs = Preferences::load(&engine.data.join("web-preferences.json"))?;
                    let (versions, _) =
                        crate::library_scores::versions(&prefs, &path, &content_id)?;
                    let version = versions
                        .iter()
                        .find(|v| v.id == version_id)
                        .ok_or("谱面版本已变化")?;
                    let bytes = atomic_file::read_limited(&version.path, 4_000_000)
                        .map_err(|e| e.to_string())?;
                    if blake3::hash(&bytes).to_hex().as_str() != version.content_id {
                        return Err("原谱内容已变化，请先核对更新后检查能力".into());
                    }
                    token.check()?;
                    let result = panthesia_core::score_document::inspect(&bytes)?;
                    token.check()?;
                    return serde_json::to_value(result).map_err(|e| e.to_string());
                }
                let (path, content, edit) = match command {
                    Command::ReadRepertoire { path, content_id } => (path, content_id, None),
                    Command::EditRepertoire { request } => (None, None, Some(request)),
                    _ => return Err("作品操作无效".into()),
                };
                let selected = content
                    .clone()
                    .or_else(|| edit.as_ref().map(|e| e.content_id.clone()));
                let data = engine.data.clone();
                let capture_data = data.clone();
                let (result, writes, observed) = atomic_file::capture_matching(
                    std::sync::Arc::new(move |path: &Path| {
                        crate::asset_storage::captures(&capture_data, path)
                    }),
                    || {
                        let (mut registry, revision) = read(&data)?;
                        migrate(
                            &mut registry,
                            &data,
                            path.as_deref(),
                            content.as_deref(),
                            &|| token.check(),
                        )?;
                        if let Some(edit) = edit {
                            if edit.expected != revision {
                                return Err("作品资料已变化，请刷新；当前编辑内容保留".into());
                            }
                            if let Some(work) = edit.work_id {
                                registry.link(&edit.content_id, &work)?;
                            }
                            let performance = registry
                                .performances
                                .get(&edit.content_id)
                                .ok_or("请先检查并登记此曲目")?;
                            let work = registry
                                .works
                                .get_mut(&performance.work_id)
                                .ok_or("作品资料缺失")?;
                            if let Some(title) = edit.title {
                                let title = bounded(title, 200)?;
                                if title.is_empty() {
                                    return Err("请填写作品标题".into());
                                }
                                work.title = title;
                            }
                            if let Some(composer) = edit.composer {
                                work.composer = bounded(composer, 160)?;
                            }
                            if let Some(catalogue) = edit.catalogue {
                                work.catalogue = bounded(catalogue, 100)?;
                            }
                            if let Some(id) = edit.notation_id {
                                let notation =
                                    registry.notations.get_mut(&id).ok_or("谱面版本已变化")?;
                                if notation.performance_id != edit.content_id {
                                    return Err("谱面属于另一演奏版本".into());
                                }
                                if let Some(quality) = edit.quality {
                                    notation.quality = quality;
                                }
                                if let Some(source) = edit.source {
                                    notation.source = bounded(source, 2000)?;
                                }
                            }
                        }
                        registry.validate()?;
                        let bytes =
                            serde_json::to_vec_pretty(&registry).map_err(|e| e.to_string())?;
                        // Even the initial migration uses the existing optimistic transaction lane.
                        let destination = data.join("repertoire.json");
                        if atomic_file::read_limited(&destination, 64_000_000)
                            .ok()
                            .as_deref()
                            != Some(&bytes)
                        {
                            atomic_file::write(&destination, &bytes).map_err(|e| e.to_string())?;
                        }
                        let mut notation_statuses = std::collections::BTreeMap::new();
                        for notation in registry
                            .notations
                            .values()
                            .filter(|n| selected.as_deref() == Some(n.performance_id.as_str()))
                        {
                            token.check()?;
                            let status = if !notation.registered {
                                "retained"
                            } else {
                                match atomic_file::read_limited(
                                    Path::new(&notation.path),
                                    4_000_000,
                                ) {
                                    Ok(bytes)
                                        if blake3::hash(&bytes).to_hex().as_str()
                                            == notation.content_id =>
                                    {
                                        "ready"
                                    }
                                    Ok(_) => "changed",
                                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => "missing",
                                    Err(_) => "unreadable",
                                }
                            };
                            notation_statuses.insert(notation.id.clone(), status.into());
                        }
                        let project = if let Some(cid)=selected.as_deref() {
                            let prefs=Preferences::load(&data.join("web-preferences.json"))?;
                            let active=path.as_ref().and_then(|p| {
                                let score=panthesia_core::library::load_song_sidecar(p,cid).ok()?.score?;
                                let actual=crate::library_workspace::key(&panthesia_core::library::resolve_score_path(p,&score));
                                registry.notations.values().find(|n|n.performance_id==cid && n.content_id==score.content_id &&
                                    crate::library_workspace::key(Path::new(&n.path)).trim_start_matches("//?/")==actual.trim_start_matches("//?/"))
                                    .map(|n|n.id.clone())
                            });
                            let mut project=panthesia_core::song_project::SongProject::from_registry(&registry,cid,
                                prefs.variants.get(cid).cloned().unwrap_or_default(),active.as_deref())?;
                            for notation in &mut project.notations {notation.status=notation_statuses.get(&notation.edition.id).cloned().unwrap_or_else(||"unverified".into());}
                            match crate::notation_drafts::list(&data,cid) {
                                Ok(list)=> {
                                    project.issues=list.issues;
                                    for draft in list.drafts {
                                        if let Some(generation)=draft.generation {
                                            for notation in &mut project.notations {
                                                if notation.edition.content_id==draft.fingerprint {notation.generation=Some(generation.clone());}
                                            }
                                            project.generations.push(generation);
                                        }
                                    }
                                },
                                Err(error)=>project.issues.push(error),
                            }
                            Some(project)
                        } else {None};
                        Ok::<_, String>(RepertoireView {
                            registry,
                            revision: blake3::hash(&bytes).to_hex().to_string(),
                            notation_statuses,
                            project,
                        })
                    },
                );
                let result = result?;
                token.check()?;
                crate::asset_storage::commit_at(&data, writes, observed, || token.begin_commit())?;
                serde_json::to_value(result).map_err(|e| e.to_string())
            })
    }
}
