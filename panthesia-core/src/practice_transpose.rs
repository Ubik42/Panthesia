//! Key-aware diatonic spelling for a disposable MusicXML display copy.
use quick_xml::{
    Reader, Writer,
    events::{BytesStart, BytesText, Event},
};
use std::collections::HashMap;
const NAMES: [&str; 7] = ["C", "D", "E", "F", "G", "A", "B"];
const NATURAL: [i16; 7] = [0, 2, 4, 5, 7, 9, 11];
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}
fn value(source: &[u8], name: &[u8]) -> Result<String, String> {
    let mut r = Reader::from_reader(source);
    loop {
        match r.read_event().map_err(err)? {
            Event::Start(tag) if tag.name().as_ref() == name => {
                return r
                    .read_text(tag.name())
                    .map_err(err)?
                    .decode()
                    .map(|v| v.into_owned())
                    .map_err(err);
            }
            Event::Eof => return Err(format!("谱面缺少 {}", String::from_utf8_lossy(name))),
            _ => {}
        }
    }
}
fn attr(tag: &BytesStart, name: &[u8]) -> Option<String> {
    tag.attributes()
        .flatten()
        .find(|a| a.key.as_ref() == name)
        .map(|a| String::from_utf8_lossy(&a.value).into_owned())
}
fn step(value: &str) -> Result<i16, String> {
    NAMES
        .iter()
        .position(|n| *n == value)
        .map(|n| n as i16)
        .ok_or_else(|| "谱面音名无效".into())
}
fn key_alter(fifths: i16, step: i16) -> i16 {
    let order = if fifths < 0 {
        [6, 2, 5, 1, 4, 0, 3]
    } else {
        [3, 0, 4, 1, 5, 2, 6]
    };
    if order[..usize::from(fifths.unsigned_abs().min(7))].contains(&step) {
        fifths.signum()
    } else {
        0
    }
}
#[derive(Clone, Copy)]
struct Key {
    target: i16,
    steps: i16,
}
impl Key {
    fn new(source: i16, semitones: i8) -> Result<Self, String> {
        if !(-7..=7).contains(&source) {
            return Err("当前转调支持七个升降号以内的传统调号".into());
        }
        let target = if semitones % 12 == 0 {
            source
        } else {
            (-7i16..=7)
                .filter(|f| (f * 7 - source * 7 - i16::from(semitones)).rem_euclid(12) == 0)
                .min_by_key(|f| (f.abs(), (f.signum() != source.signum()) as u8))
                .unwrap()
        };
        let from = (source * 4).rem_euclid(7);
        let to = (target * 4).rem_euclid(7);
        let chromatic_from = NATURAL[from as usize] + key_alter(source, from);
        let chromatic_to = NATURAL[to as usize] + key_alter(target, to);
        let octaves = (chromatic_from + i16::from(semitones) - chromatic_to).div_euclid(12);
        Ok(Self {
            target,
            steps: to - from + 7 * octaves,
        })
    }
    fn pitch(self, original_step: i16, alter: i16, octave: i16, semitones: i8) -> (i16, i16, i16) {
        let diatonic = octave * 7 + original_step + self.steps;
        let new_step = diatonic.rem_euclid(7);
        let new_octave = diatonic.div_euclid(7);
        let target = NATURAL[original_step as usize] + octave * 12 + alter + i16::from(semitones);
        (
            new_step,
            target - NATURAL[new_step as usize] - new_octave * 12,
            new_octave,
        )
    }
}
fn plain(w: &mut Writer<Vec<u8>>, tag: &BytesStart, text: &str) -> Result<(), String> {
    w.write_event(Event::Start(tag.to_owned())).map_err(err)?;
    w.write_event(Event::Text(BytesText::new(text)))
        .map_err(err)?;
    w.write_event(Event::End(tag.to_end())).map_err(err)
}
fn accidental(value: &str) -> Result<i16, String> {
    match value {
        "natural" => Ok(0),
        "sharp" => Ok(1),
        "flat" => Ok(-1),
        "double-sharp" | "sharp-sharp" => Ok(2),
        "flat-flat" => Ok(-2),
        _ => Err("装饰音使用尚未支持的微分音记号".into()),
    }
}
fn accidental_name(alter: i16) -> Result<&'static str, String> {
    match alter {
        0 => Ok("natural"),
        1 => Ok("sharp"),
        -1 => Ok("flat"),
        2 => Ok("double-sharp"),
        -2 => Ok("flat-flat"),
        _ => Err("装饰音转调后需要两个以上升降号".into()),
    }
}
fn number(source: &[u8], tag: &[u8], default: Option<i16>) -> Result<i16, String> {
    match value(source, tag) {
        Ok(text) => text
            .parse::<i16>()
            .map_err(|_| "谱面使用尚未支持的微分音或无效音高".into()),
        Err(error) => default.ok_or(error),
    }
}
fn note(source: &[u8], key: Key, semitones: i8) -> Result<Vec<u8>, String> {
    let mut r = Reader::from_reader(source);
    let mut w = Writer::new(Vec::with_capacity(source.len()));
    let mut in_ornaments = false;
    let original_pitch = value(source, b"pitch").ok();
    let main = original_pitch
        .as_ref()
        .map(|p| -> Result<_, String> {
            Ok((
                step(&value(p.as_bytes(), b"step")?)?,
                number(p.as_bytes(), b"octave", None)?,
            ))
        })
        .transpose()?;
    loop {
        match r.read_event().map_err(err)? {
            Event::Eof => break,
            Event::Start(tag) if tag.name().as_ref() == b"pitch" => {
                let p = r.read_text(tag.name()).map_err(err)?;
                let s = step(&value(p.as_ref(), b"step")?)?;
                let a = number(p.as_ref(), b"alter", Some(0))?;
                let o = number(p.as_ref(), b"octave", None)?;
                let (s, a, o) = key.pitch(s, a, o, semitones);
                write_pitch(&mut w, s, a, o)?;
            }
            Event::Start(tag) if tag.name().as_ref() == b"accidental" => {
                r.read_to_end(tag.name()).map_err(err)?;
            }
            Event::Empty(tag) if tag.name().as_ref() == b"accidental" => {}
            Event::Start(tag) if tag.name().as_ref() == b"ornaments" => {
                in_ornaments = true;
                w.write_event(Event::Start(tag)).map_err(err)?;
            }
            Event::End(tag) if tag.name().as_ref() == b"ornaments" => {
                in_ornaments = false;
                w.write_event(Event::End(tag)).map_err(err)?;
            }
            Event::Start(tag)
                if tag.name().as_ref() == b"accidental-mark" && main.is_some() && in_ornaments =>
            {
                let text = r
                    .read_text(tag.name())
                    .map_err(err)?
                    .decode()
                    .map_err(err)?
                    .into_owned();
                let (s, o) = main.unwrap();
                let neighbor = o * 7
                    + s
                    + if attr(&tag, b"placement").as_deref() == Some("below") {
                        -1
                    } else {
                        1
                    };
                let (_, alter, _) = key.pitch(
                    neighbor.rem_euclid(7),
                    accidental(&text)?,
                    neighbor.div_euclid(7),
                    semitones,
                );
                plain(&mut w, &tag, accidental_name(alter)?)?;
            }
            e => w.write_event(e).map_err(err)?,
        }
    }
    Ok(w.into_inner())
}
fn write_pitch(w: &mut Writer<Vec<u8>>, s: i16, a: i16, o: i16) -> Result<(), String> {
    let midi = (o + 1) * 12 + NATURAL[s as usize] + a;
    if !(0..=127).contains(&midi) {
        return Err("转调后的谱面音高超出 MIDI 音域".into());
    }
    w.get_mut().extend_from_slice(
        format!(
            "<pitch><step>{}</step><alter>{a}</alter><octave>{o}</octave></pitch>",
            NAMES[s as usize]
        )
        .as_bytes(),
    );
    Ok(())
}
fn harmony(source: &[u8], key: Key, semitones: i8) -> Result<Vec<u8>, String> {
    let mut r = Reader::from_reader(source);
    let mut w = Writer::new(Vec::with_capacity(source.len()));
    loop {
        match r.read_event().map_err(err)? {
            Event::Eof => break,
            Event::Start(tag) if matches!(tag.name().as_ref(), b"root" | b"bass") => {
                let root = tag.name().as_ref() == b"root";
                let prefix = if root { "root" } else { "bass" };
                let inner = r.read_text(tag.name()).map_err(err)?;
                let s = step(&value(inner.as_ref(), format!("{prefix}-step").as_bytes())?)?;
                let a = number(
                    inner.as_ref(),
                    format!("{prefix}-alter").as_bytes(),
                    Some(0),
                )?;
                let (s, a, _) = key.pitch(s, a, 4, semitones);
                // Recompute written names; a source 'text' override would print the old root.
                w.write_event(Event::Start(tag.to_owned())).map_err(err)?;
                w.get_mut().extend_from_slice(
                    format!(
                        "<{prefix}-step>{}</{prefix}-step><{prefix}-alter>{a}</{prefix}-alter>",
                        NAMES[s as usize]
                    )
                    .as_bytes(),
                );
                w.write_event(Event::End(tag.to_end())).map_err(err)?;
            }
            // Fretboard positions encode the original pitches; a shifted chord label cannot reuse them.
            Event::Start(tag) if tag.name().as_ref() == b"frame" => {
                r.read_to_end(tag.name()).map_err(err)?;
            }
            e => w.write_event(e).map_err(err)?,
        }
    }
    Ok(w.into_inner())
}
pub fn transpose(source: &[u8], semitones: i8) -> Result<Vec<u8>, String> {
    if semitones == 0 {
        return Ok(source.to_vec());
    }
    if !(-24..=24).contains(&semitones) {
        return Err("谱面转调超出两个八度".into());
    }
    let source = crate::musicxml::partwise_musicxml_source(source).map_err(err)?;
    let mut r = Reader::from_reader(source.as_slice());
    let mut w = Writer::new(Vec::with_capacity(source.len()));
    let mut default = Key::new(0, semitones)?;
    let mut staves: HashMap<String, Key> = HashMap::new();
    loop {
        match r.read_event().map_err(err)? {
            Event::Eof => break,
            Event::Start(tag) if tag.name().as_ref() == b"part" => {
                default = Key::new(0, semitones)?;
                staves.clear();
                w.write_event(Event::Start(tag)).map_err(err)?;
            }
            Event::Start(tag) if tag.name().as_ref() == b"key" => {
                let inner = r.read_text(tag.name()).map_err(err)?;
                let key = Key::new(number(inner.as_ref(), b"fifths", None)?, semitones)?;
                let previous = if let Some(staff) = attr(&tag, b"number") {
                    staves.insert(staff, key).unwrap_or(default)
                } else {
                    let old = default;
                    default = key;
                    staves.clear();
                    old
                };
                w.write_event(Event::Start(tag.to_owned())).map_err(err)?;
                let mut kr = Reader::from_reader(inner.as_ref());
                loop {
                    match kr.read_event().map_err(err)? {
                        Event::Eof => break,
                        Event::Start(k) if k.name().as_ref() == b"fifths" => {
                            kr.read_to_end(k.name()).map_err(err)?;
                            plain(&mut w, &k, &key.target.to_string())?;
                        }
                        Event::Start(k) if k.name().as_ref() == b"cancel" => {
                            kr.read_to_end(k.name()).map_err(err)?;
                            plain(&mut w, &k, &previous.target.to_string())?;
                        }
                        e => w.write_event(e).map_err(err)?,
                    }
                }
                w.write_event(Event::End(tag.to_end())).map_err(err)?;
            }
            Event::Start(tag) if matches!(tag.name().as_ref(), b"note" | b"harmony") => {
                let inner = r.read_text(tag.name()).map_err(err)?;
                let staff = value(inner.as_ref(), b"staff").unwrap_or_else(|_| "1".into());
                let key = staves.get(&staff).copied().unwrap_or(default);
                let bytes = if tag.name().as_ref() == b"note" {
                    note(inner.as_ref(), key, semitones)?
                } else {
                    harmony(inner.as_ref(), key, semitones)?
                };
                w.write_event(Event::Start(tag.to_owned())).map_err(err)?;
                w.get_mut().extend_from_slice(&bytes);
                w.write_event(Event::End(tag.to_end())).map_err(err)?;
            }
            e => w.write_event(e).map_err(err)?,
        }
    }
    Ok(w.into_inner())
}
