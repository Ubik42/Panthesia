//! Library-owned files share exclusive preparation and recoverable publication with score assets.
use crate::Command;
use std::path::Path;

pub(crate) fn supports(command: &Command) -> bool {
    matches!(
        command,
        Command::SaveSongLearning { .. }
            | Command::ImportSynthesiaMetadata { .. }
            | Command::ResetLibraryMetadataDefaults { .. }
            | Command::SaveLibraryMetadata { .. }
            | Command::RestoreLibraryMetadata { .. }
            | Command::UpdateSongMetadata { .. }
            | Command::LibraryGroup { .. }
            | Command::RemoveLibraryGroup { .. }
            | Command::AssignLibrary { .. }
            | Command::UnassignLibrary { .. }
            | Command::InspectSong { .. }
            | Command::InspectSongs { .. }
            | Command::UpdateMetadataTemplate { .. }
            | Command::RelinkLibrary { .. }
            | Command::SetLibraryPrimary { .. }
            | Command::IgnoreLibraryPath { .. }
            | Command::RestoreLibraryPath { .. }
            | Command::DecideMidiReplacement { .. }
            | Command::ClaimPendingMetadataHistory { .. }
    )
}
pub(crate) fn reads(command: &Command) -> bool {
    matches!(command, Command::PreviewSynthesiaMetadata { .. }) || crate::library_workspace::reads(command)
        || matches!(
            command,
            Command::MetadataTemplates
                | Command::MidiReplacements { .. }
                | Command::PreviewMidiReplacement { .. }
                | Command::PendingMetadataHistory
                | Command::PendingMetadataHistoryPage { .. }
                | Command::ReadLibraryPath { .. }
                | Command::ReadMetadataHistoryClaim { .. }
        )
}
pub(crate) fn label(command: &Command) -> &'static str {
    match command {
        Command::ImportSynthesiaMetadata { .. } => "导入 Synthesia 资料",
        Command::PreviewSynthesiaMetadata { .. } => "预览 Synthesia 资料",
        Command::SaveSongLearning { .. } => "保存学习资料",
        Command::ReadSongLearning { .. } => "读取学习资料",
        Command::SaveLibraryMetadata { .. } | Command::UpdateSongMetadata { .. } => "保存曲库信息",
        Command::ResetLibraryMetadataDefaults { .. } => "恢复来源默认资料",
        Command::RestoreLibraryMetadata { .. } => "恢复曲库信息",
        Command::ReadLibraryMetadata { .. } => "读取曲库信息",
        Command::PreviewLibraryMetadata { .. } => "预览曲库信息",
        Command::LibraryMetadataHistory { .. } | Command::PreviewMetadataRestore { .. } => {
            "读取资料修改历史"
        }
        Command::MetadataTemplates => "读取资料模板",
        Command::UpdateMetadataTemplate { .. } => "保存资料模板",
        Command::InspectSong { .. } | Command::InspectSongs { .. } => "更新曲目资料",
        Command::LibraryWorkspace => "读取曲库资料",
        Command::MidiReplacements { .. } => "读取文件内容变化",
        Command::PreviewMidiReplacement { .. } => "比较文件内容变化",
        Command::DecideMidiReplacement { .. } => "保存文件变化处理",
        Command::RelinkLibrary { .. } => "关联曲目文件位置",
        Command::SetLibraryPrimary { .. }
        | Command::IgnoreLibraryPath { .. }
        | Command::RestoreLibraryPath { .. } => "保存曲目文件位置",
        Command::PendingMetadataHistory | Command::PendingMetadataHistoryPage { .. } => {
            "读取待认领资料历史"
        }
        Command::ReadLibraryPath { .. } => "核对曲目文件位置",
        Command::ReadMetadataHistoryClaim { .. } => "读取资料历史认领结果",
        Command::ClaimPendingMetadataHistory { .. } => "认领资料修改历史",
        _ => "保存曲库整理",
    }
}
pub(crate) fn content(command: &Command) -> Option<String> {
    match command {
        Command::SaveSongLearning { content_id, .. }
        | Command::ReadSongLearning { content_id }
        | Command::SaveLibraryMetadata { content_id, .. }
        | Command::ResetLibraryMetadataDefaults { content_id, .. }
        | Command::RestoreLibraryMetadata { content_id, .. }
        | Command::LibraryMetadataHistory { content_id, .. }
        | Command::PreviewMetadataRestore { content_id, .. } => Some(content_id.clone()),
        Command::SetLibraryPrimary { content_id, .. }
        | Command::IgnoreLibraryPath { content_id, .. }
        | Command::RestoreLibraryPath { content_id, .. }
        | Command::ClaimPendingMetadataHistory { content_id, .. } => Some(content_id.clone()),
        Command::ReadLibraryPath { content_id, .. } => Some(content_id.clone()),
        Command::ReadLibraryMetadata { content_id, .. }
        | Command::PreviewLibraryMetadata { content_id, .. } => content_id.clone(),
        _ => None,
    }
}
pub(crate) fn execute(
    command: Command,
    data: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    match command {
        Command::ImportSynthesiaMetadata { bytes, paths, options, expected } => crate::synthesia_import::apply(data, bytes, paths, options, expected, check),
        Command::RelinkLibrary { items } => {
            crate::library_repairs::relink_checked(data, items, check)
        }
        Command::SetLibraryPrimary { content_id, path } => {
            crate::library_repairs::set_primary_checked(data, &content_id, path, check)
        }
        Command::IgnoreLibraryPath { content_id, path } => {
            crate::library_repairs::ignore_path_checked(data, &content_id, &path, check)
        }
        Command::RestoreLibraryPath { content_id, path } => {
            crate::library_repairs::restore_path_checked(data, &content_id, &path, check)
        }
        Command::DecideMidiReplacement {
            path,
            old_content_id,
            new_content_id,
            token,
            action,
            target,
        } => crate::library_repairs::decide_replacement_checked(
            data,
            &path,
            &old_content_id,
            &new_content_id,
            &token,
            &action,
            target,
            check,
        ),
        Command::ClaimPendingMetadataHistory {
            source_path,
            content_id,
            target_path,
            request_id,
            expected,
        } => claim_history(
            data,
            &source_path,
            &content_id,
            &target_path,
            request_id.as_deref(),
            expected.as_deref(),
            check,
        ),
        Command::UpdateMetadataTemplate {
            name,
            rules,
            expected,
        } => crate::metadata_templates::update_checked(data, name, rules, expected, check),
        other => crate::library_workspace::execute_checked(other, data, check),
    }
}
pub(crate) fn read(
    command: Command,
    data: &Path,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    match command {
        Command::PreviewSynthesiaMetadata { bytes, paths, options } => crate::synthesia_import::preview(data, bytes, paths, options, check),
        Command::PendingMetadataHistoryPage {
            query,
            offset,
            limit,
        } => {
            let lock = crate::library_workspace::lock_for(data)?;
            let _guard = crate::library_workspace::wait_for(&lock, check)?;
            let mut workspace = crate::library_workspace::Workspace::load(data)?;
            crate::metadata_history::pending_page_checked(
                data,
                &mut workspace,
                &query,
                offset,
                limit,
                check,
            )
        }
        Command::ReadMetadataHistoryClaim { request_id } => {
            check()?;
            let lock = crate::library_workspace::lock_for(data)?;
            let _guard = crate::library_workspace::wait_for(&lock, check)?;
            let result = crate::metadata_claims::read(data, &request_id)?;
            check()?;
            serde_json::to_value(result).map_err(|e| e.to_string())
        }
        Command::ReadLibraryPath { content_id, path } => {
            crate::library_repairs::read_path(data, &content_id, &path, check)
        }
        Command::MidiReplacements {
            query,
            include_reviewed,
            offset,
            limit,
        } => crate::library_repairs::replacements_checked(
            data,
            &query,
            include_reviewed,
            offset,
            limit,
            check,
        ),
        Command::PreviewMidiReplacement {
            path,
            old_content_id,
            new_content_id,
        } => crate::library_repairs::preview_replacement_checked(
            data,
            &path,
            &old_content_id,
            &new_content_id,
            check,
        ),
        Command::PendingMetadataHistory => {
            let lock = crate::library_workspace::lock_for(data)?;
            let _guard = crate::library_workspace::wait_for(&lock, check)?;
            let mut workspace = crate::library_workspace::Workspace::load(data)?;
            crate::metadata_history::pending_rows_checked(data, &mut workspace, check)
        }
        Command::MetadataTemplates => crate::metadata_templates::inspect_checked(data, check),
        other => crate::library_workspace::read_checked(other, data, check),
    }
}
fn claim_history(
    data: &Path,
    source: &Path,
    cid: &str,
    target: &Path,
    request_id: Option<&str>,
    expected: Option<&str>,
    check: &impl Fn() -> Result<(), String>,
) -> Result<serde_json::Value, String> {
    let lock = crate::library_workspace::lock_for(data)?;
    let _guard = crate::library_workspace::wait_for(&lock, check)?;
    if let Some(receipt) = request_id
        .map(|id| crate::metadata_claims::read(data, id))
        .transpose()?
        .flatten()
    {
        if receipt.content_id != cid
            || crate::library_workspace::key(&receipt.source_path)
                != crate::library_workspace::key(source)
            || crate::library_workspace::key(&receipt.target_path)
                != crate::library_workspace::key(target)
            || expected.is_some_and(|value| value != receipt.fingerprint)
        {
            return Err("认领请求编号已用于其他来源或目标，请保留原请求并核对".into());
        }
        return serde_json::to_value(receipt).map_err(|e| e.to_string());
    }
    let mut workspace = crate::library_workspace::Workspace::load(data)?;
    let mut result = crate::metadata_history::claim_pending_checked(
        data,
        &mut workspace,
        source,
        cid,
        target,
        expected,
        check,
    )?;
    if let Some(id) = request_id {
        let receipt = crate::metadata_claims::MetadataHistoryClaim {
            version: 1,
            request_id: id.into(),
            source_path: source.into(),
            content_id: cid.into(),
            target_path: target.into(),
            records: result["records"].as_u64().ok_or("认领结果缺少记录数量")? as usize,
            added: result["added"].as_u64().ok_or("认领结果缺少新增数量")? as usize,
            fingerprint: result["fingerprint"]
                .as_str()
                .ok_or("认领结果缺少原记录身份")?
                .into(),
        };
        check()?;
        crate::metadata_claims::save(data, &receipt)?;
        result = serde_json::to_value(receipt).map_err(|e| e.to_string())?;
    }
    check()?;
    workspace.save(data)?;
    Ok(result)
}
