use std::{
    cell::{Cell, RefCell},
    error::Error,
    fs, io,
    path::{Path, PathBuf},
    rc::Rc,
};

use cpal::traits::{DeviceTrait, HostTrait};
use midi_file::midly::{self, num::u4};
use vst3_host::{
    AudioHandle, Vst3Host,
    audio::AudioConfig,
    midi::{MidiChannel, MidiEvent},
    window::PluginWindow,
};

const DEFAULT_BLOCK_SIZE: usize = 256;
const MAX_STATE_BYTES: u64 = 16 * 1024 * 1024;

pub struct Vst3Backend {
    config: AudioConfig,
    plugins: Vec<PathBuf>,
    device: Option<String>,
}

impl Vst3Backend {
    pub fn new() -> Result<Self, Box<dyn Error>> {
        Self::for_device(None)
    }
    pub fn for_device(name: Option<&str>) -> Result<Self, Box<dyn Error>> {
        let host = cpal::default_host();
        let device = if let Some(name)=name {
            host.output_devices()?.find(|d| d.id().is_ok_and(|id|id.to_string()==name)||d.to_string()==name)
        } else {host.default_output_device()}.ok_or("所选扬声器或耳机不可用")?;
        let output = device.default_output_config()?;

        let config = AudioConfig {
            sample_rate: output.sample_rate() as f64,
            block_size: DEFAULT_BLOCK_SIZE,
            input_channels: 0,
            output_channels: 2,
            ..Default::default()
        };

        Ok(Self {
            config,
            plugins: discover_standard_plugins(),
            device: name.map(str::to_owned),
        })
    }

    pub fn get_outputs(&self) -> Vec<PathBuf> {
        self.plugins.iter().cloned().collect()
    }

    pub fn has_output(&self, path: &Path) -> io::Result<bool> {
        let canonical = path.canonicalize()?;
        Ok(self.plugins.iter().any(|candidate| {
            candidate == path || candidate.canonicalize().ok().as_ref() == Some(&canonical)
        }))
    }

    pub fn new_output_connection(
        &self,
        path: &Path,
    ) -> Result<Vst3OutputConnection, Box<dyn Error>> {
        let mut host = Vst3Host::builder()
            .sample_rate(self.config.sample_rate)
            .block_size(self.config.block_size)
            .input_channels(0)
            .output_channels(self.config.output_channels)
            .build()?;
        let mut plugin = host.load_plugin(path)?;
        let info = plugin.info().clone();
        if !info.has_midi_input || info.audio_outputs == 0 {
            return Err(format!(
                "{} is not a playable instrument (MIDI input: {}, audio outputs: {})",
                info.name, info.has_midi_input, info.audio_outputs
            )
            .into());
        }

        let state_path = plugin_state_path(&info.uid);
        if let Some(state_path) = &state_path
            && let Err(error) = restore_plugin_state(&mut plugin, state_path)
        {
            // A missing or stale state must never prevent the instrument from
            // loading with its own defaults.
            log::warn!(
                "Could not restore VST3 state from {}: {error}",
                state_path.display()
            );
        }

        log::info!(
            "Loaded VST3 instrument '{}' by {} ({} Hz, {} samples)",
            info.name,
            info.vendor,
            self.config.sample_rate,
            self.config.block_size
        );
        let backend=SelectedAudio {inner:vst3_host::backends::CpalBackend::new()?,device:self.device.clone()};
        let audio = vst3_host::playback::play_with_backend(&backend,plugin,self.config)?;
        let midi = audio.midi_sink();

        Ok(Vst3OutputConnection {
            shared: Rc::new(Vst3Shared {
                audio,
                editor: RefCell::new(None),
                state_path,
                persist_state: Cell::new(true),
            }),
            midi,
        })
    }
}

/// Use the same explicit endpoint for the plugin and the built-in piano.
struct SelectedAudio {inner:vst3_host::backends::CpalBackend,device:Option<String>}
impl vst3_host::audio::AudioBackend for SelectedAudio {
    type Device=cpal::Device;
    type Stream=<vst3_host::backends::CpalBackend as vst3_host::audio::AudioBackend>::Stream;
    type Error=<vst3_host::backends::CpalBackend as vst3_host::audio::AudioBackend>::Error;
    fn enumerate_output_devices(&self)->Result<Vec<Self::Device>,Self::Error>{self.inner.enumerate_output_devices()}
    fn enumerate_input_devices(&self)->Result<Vec<Self::Device>,Self::Error>{self.inner.enumerate_input_devices()}
    fn default_output_device(&self)->Option<Self::Device>{match &self.device {None=>self.inner.default_output_device(),Some(name)=>self.inner.enumerate_output_devices().ok()?.into_iter().find(|d|d.id().is_ok_and(|id|id.to_string()==*name)||d.to_string()==*name)}}
    fn default_input_device(&self)->Option<Self::Device>{self.inner.default_input_device()}
    fn create_output_stream(&self,device:&Self::Device,config:AudioConfig,data:Box<dyn FnMut(&mut[f32])+Send>,error:Box<dyn FnMut(Self::Error)+Send>)->Result<Self::Stream,Self::Error>{self.inner.create_output_stream(device,config,data,error)}
    fn create_input_stream(&self,device:&Self::Device,config:AudioConfig,data:Box<dyn FnMut(&[f32])+Send>,error:Box<dyn FnMut(Self::Error)+Send>)->Result<Self::Stream,Self::Error>{self.inner.create_input_stream(device,config,data,error)}
}

#[derive(Clone)]
pub struct Vst3OutputConnection {
    shared: Rc<Vst3Shared>,
    midi: vst3_host::MidiSink,
}

struct Vst3Shared {
    // AudioHandle owns the live CPAL stream and must stay on the creating UI thread.
    audio: AudioHandle,
    editor: RefCell<Option<PluginWindow>>,
    state_path: Option<PathBuf>,
    persist_state: Cell<bool>,
}

impl Drop for Vst3Shared {
    fn drop(&mut self) {
        // The editor view must detach before the plugin instance is stopped.
        self.editor.get_mut().take();
        if !self.persist_state.get() {
            return;
        }
        let Some(path) = &self.state_path else {
            return;
        };
        let mut plugin = self.audio.lock();
        if let Err(error) = plugin.stop_processing() {
            log::warn!("Could not stop VST3 processing before state save: {error}");
        }
        match plugin.save_state() {
            Ok(state) => {
                if let Err(error) = atomic_write(path, &state) {
                    log::error!("Could not save VST3 state to {}: {error}", path.display());
                }
            }
            Err(error) => log::error!("Could not snapshot VST3 state: {error}"),
        }
    }
}

impl Vst3OutputConnection {
    pub fn peak(&self)->f32{self.shared.audio.output_levels().channels.iter().map(|c|c.peak).fold(0.,f32::max)}
    /// Uncommitted candidate instruments must not overwrite the active instrument's state.
    pub fn set_state_persistence(&self, enabled: bool) {
        self.shared.persist_state.set(enabled);
    }
    pub fn close_editor(&self) {
        self.shared.editor.borrow_mut().take();
    }
    pub fn save_state(&self) -> Result<(), Box<dyn Error>> {
        let Some(path) = &self.shared.state_path else {
            return Ok(());
        };
        let state = self.shared.audio.lock().save_state()?;
        atomic_write(path, &state)?;
        Ok(())
    }
    pub fn midi_event(&self, channel: u4, message: midly::MidiMessage) {
        let Some(event) = to_vst3_event(channel, message) else {
            return;
        };
        if !self.midi.send_midi(event) {
            log::warn!("VST3 MIDI queue is full; dropping {event:?}");
        }
    }

    pub fn stop_all(&self) {
        for channel in 0..16 {
            let channel = MidiChannel::from_index(channel).expect("0..16 is a MIDI channel");
            for (controller, value) in [(64, 0), (123, 0), (120, 0)] {
                if !self.midi.send_midi(MidiEvent::ControlChange {
                    channel,
                    controller,
                    value,
                }) {
                    log::warn!("VST3 MIDI queue is full while stopping all notes");
                    return;
                }
            }
        }
    }

    pub fn open_editor(&self) -> Result<(), Box<dyn Error>> {
        let mut editor = self.shared.editor.borrow_mut();
        if editor.as_ref().is_some_and(PluginWindow::closed_by_user) {
            editor.take();
        }
        if editor.is_none() {
            let mut window = PluginWindow::new(self.shared.audio.plugin());
            window.open()?;
            *editor = Some(window);
        }
        Ok(())
    }

    pub fn service_editor(&self) {
        let mut editor = self.shared.editor.borrow_mut();
        if editor.as_ref().is_some_and(PluginWindow::closed_by_user) {
            editor.take();
            return;
        }
        if let Some(window) = editor.as_ref()
            && let Err(error) = window.service_platform_events()
        {
            log::warn!("VST3 editor event service failed: {error}");
        }
    }
}

fn to_vst3_event(channel: u4, message: midly::MidiMessage) -> Option<MidiEvent> {
    let channel = MidiChannel::from_index(channel.as_int())?;
    Some(match message {
        midly::MidiMessage::NoteOff { key, vel } => MidiEvent::NoteOff {
            channel,
            note: key.as_int(),
            velocity: vel.as_int(),
        },
        midly::MidiMessage::NoteOn { key, vel } if vel.as_int() == 0 => MidiEvent::NoteOff {
            channel,
            note: key.as_int(),
            velocity: 0,
        },
        midly::MidiMessage::NoteOn { key, vel } => MidiEvent::NoteOn {
            channel,
            note: key.as_int(),
            velocity: vel.as_int(),
        },
        midly::MidiMessage::Aftertouch { key, vel } => MidiEvent::PolyAftertouch {
            channel,
            note: key.as_int(),
            pressure: vel.as_int(),
        },
        midly::MidiMessage::Controller { controller, value } => MidiEvent::ControlChange {
            channel,
            controller: controller.as_int(),
            value: value.as_int(),
        },
        midly::MidiMessage::ProgramChange { program } => MidiEvent::ProgramChange {
            channel,
            program: program.as_int(),
        },
        midly::MidiMessage::ChannelAftertouch { vel } => MidiEvent::ChannelAftertouch {
            channel,
            pressure: vel.as_int(),
        },
        midly::MidiMessage::PitchBend { bend } => MidiEvent::PitchBend {
            channel,
            value: bend.0.as_int(),
        },
    })
}

pub fn discover_standard_plugins() -> Vec<PathBuf> {
    discover_standard_plugins_with_report().plugins
}

#[derive(Default)]
pub struct PluginDiscovery {
    pub plugins: Vec<PathBuf>,
    pub warnings: Vec<String>,
}

/// Vendor subdirectories are common; a VST3 bundle is one instrument, not a scan root.
/// Canonical directory identities bound link cycles while preserving installed aliases.
pub fn discover_standard_plugins_with_report() -> PluginDiscovery {
    use std::collections::{HashSet, VecDeque};
    let mut report = PluginDiscovery::default();
    let mut pending: VecDeque<_> = standard_vst3_roots()
        .into_iter()
        .map(|path| (path, 0))
        .collect();
    let mut visited = HashSet::new();
    let mut found = HashSet::new();
    let mut entries = 0usize;
    'directories: while let Some((directory, depth)) = pending.pop_front() {
        let identity = match directory.canonicalize() {
            Ok(identity) => identity,
            Err(error) if depth == 0 && error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                report.warn(format!(
                    "插件目录未读取：{}（{error}）",
                    directory.display()
                ));
                continue;
            }
        };
        if !visited.insert(plugin_path_key(&identity)) {
            continue;
        }
        if visited.len() > 4096 {
            report.warn("插件目录超过 4096 个，本次扫描已停止；请整理标准 VST3 目录".into());
            break;
        }
        let children = match fs::read_dir(&directory) {
            Ok(children) => children,
            Err(error) if depth == 0 && error.kind() == io::ErrorKind::NotFound => continue,
            Err(error) => {
                report.warn(format!(
                    "插件目录未读取：{}（{error}）",
                    directory.display()
                ));
                continue;
            }
        };
        for child in children {
            entries += 1;
            if entries > 100_000 {
                report.warn(
                    "插件目录条目超过 100000 个，本次扫描已停止；请整理标准 VST3 目录".into(),
                );
                break 'directories;
            }
            let child = match child {
                Ok(child) => child,
                Err(error) => {
                    report.warn(format!(
                        "插件目录条目未读取：{}（{error}）",
                        directory.display()
                    ));
                    continue;
                }
            };
            let path = child.path();
            let metadata = match child.metadata() {
                Ok(metadata) => metadata,
                Err(error) => {
                    report.warn(format!("插件位置未读取：{}（{error}）", path.display()));
                    continue;
                }
            };
            let metadata = if plugin_link(&metadata) {
                match fs::metadata(&path) {
                    Ok(metadata) => metadata,
                    Err(error) => {
                        report.warn(format!("插件链接未读取：{}（{error}）", path.display()));
                        continue;
                    }
                }
            } else {
                metadata
            };
            if path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("vst3"))
            {
                if (metadata.is_file() || metadata.is_dir()) && found.insert(plugin_path_key(&path))
                {
                    report.plugins.push(path);
                }
            } else if metadata.is_dir() {
                if depth < 12 {
                    pending.push_back((path, depth + 1));
                } else {
                    report.warn(format!("插件目录层级超过 12 层：{}", path.display()));
                }
            }
        }
    }
    report.plugins.sort();
    report
}
impl PluginDiscovery {
    fn warn(&mut self, warning: String) {
        let warning = if warning.chars().count() > 1024 {
            format!("{}…", warning.chars().take(1024).collect::<String>())
        } else {
            warning
        };
        if self.warnings.len() < 20 {
            self.warnings.push(warning);
        } else if self.warnings.len() == 20 {
            self.warnings
                .push("还有其他插件位置未能读取，请检查标准 VST3 目录的访问权限".into());
        }
    }
}
fn plugin_path_key(path: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        PathBuf::from(path.to_string_lossy().replace('/', "\\").to_lowercase())
    }
    #[cfg(not(target_os = "windows"))]
    {
        path.to_path_buf()
    }
}
fn plugin_link(metadata: &fs::Metadata) -> bool {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0
    }
    #[cfg(not(target_os = "windows"))]
    {
        metadata.file_type().is_symlink()
    }
}

fn standard_vst3_roots() -> Vec<PathBuf> {
    let mut roots = Vec::new();
    #[cfg(target_os = "windows")]
    {
        if let Some(program_files) = std::env::var_os("PROGRAMFILES") {
            roots.push(
                PathBuf::from(program_files)
                    .join("Common Files")
                    .join("VST3"),
            );
        }
        if let Some(common) = std::env::var_os("COMMONPROGRAMFILES") {
            let root = PathBuf::from(common).join("VST3");
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
    }
    #[cfg(target_os = "macos")]
    roots.push(PathBuf::from("/Library/Audio/Plug-Ins/VST3"));
    #[cfg(target_os = "linux")]
    {
        roots.push(PathBuf::from("/usr/lib/vst3"));
        roots.push(PathBuf::from("/usr/local/lib/vst3"));
    }
    roots
}

fn plugin_state_path(uid: &str) -> Option<PathBuf> {
    if uid.len() != 32 || !uid.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        log::warn!("VST3 plugin returned an invalid class UID; state persistence is disabled");
        return None;
    }
    let parent = panthesia_core::utils::resources::settings_ron()?
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join("vst3-state");
    Some(parent.join(format!("{}.bin", uid.to_ascii_lowercase())))
}

fn restore_plugin_state(plugin: &mut vst3_host::Plugin, path: &Path) -> Result<(), Box<dyn Error>> {
    let metadata = match fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if metadata.len() > MAX_STATE_BYTES {
        return Err(format!(
            "state is {} bytes, exceeding the {} byte safety limit",
            metadata.len(),
            MAX_STATE_BYTES
        )
        .into());
    }
    let state = fs::read(path)?;
    plugin.load_state(&state)?;
    log::info!("Restored VST3 state from {}", path.display());
    Ok(())
}

fn atomic_write(path: &Path, contents: &[u8]) -> io::Result<()> {
    if contents.len() as u64 > MAX_STATE_BYTES {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "插件状态超过 16 MB，现有配置未替换",
        ));
    }
    // Share the synced, unique temporary-file publisher used by the practice store.
    panthesia_core::utils::atomic_file::write(path, contents)
}

#[cfg(test)]
fn unix_time_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

#[cfg(test)]
mod tests {
    use super::*;
    use midi_file::midly::num::u7;

    #[test]
    fn note_on_with_zero_velocity_becomes_note_off() {
        let event = to_vst3_event(
            u4::new(2),
            midly::MidiMessage::NoteOn {
                key: u7::new(60),
                vel: u7::new(0),
            },
        );
        assert_eq!(
            event,
            Some(MidiEvent::NoteOff {
                channel: MidiChannel::Ch3,
                note: 60,
                velocity: 0,
            })
        );
    }

    #[test]
    fn pitch_bend_preserves_fourteen_bit_value() {
        let event = to_vst3_event(
            u4::new(0),
            midly::MidiMessage::PitchBend {
                bend: midly::PitchBend(midly::num::u14::new(12_345)),
            },
        );
        assert_eq!(
            event,
            Some(MidiEvent::PitchBend {
                channel: MidiChannel::Ch1,
                value: 12_345,
            })
        );
    }

    #[test]
    fn discovered_plugins_are_vst3_paths() {
        assert!(discover_standard_plugins().iter().all(|path| {
            path.extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("vst3"))
        }));
    }

    #[test]
    fn state_path_requires_a_canonical_class_uid() {
        assert!(plugin_state_path("not-a-vst3-uid").is_none());
        let path = plugin_state_path("00112233445566778899AABBCCDDEEFF").unwrap();
        assert_eq!(
            path.file_name().and_then(|name| name.to_str()),
            Some("00112233445566778899aabbccddeeff.bin")
        );
    }

    #[test]
    fn state_file_is_replaced_without_partial_contents() {
        let root = std::env::temp_dir().join(format!(
            "panthesia-vst3-state-test-{}-{}",
            std::process::id(),
            unix_time_ms()
        ));
        let path = root.join("state.bin");
        atomic_write(&path, b"first").unwrap();
        atomic_write(&path, b"second state").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"second state");
        fs::remove_file(path).unwrap();
        fs::remove_dir(root).unwrap();
    }
}
