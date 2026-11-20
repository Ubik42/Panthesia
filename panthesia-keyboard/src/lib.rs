//! Keyboard geometry derives from the seven white-key positions in each twelve-tone octave.
use std::{
    ops::{Bound, Range, RangeBounds},
    sync::Arc,
};
pub mod range {
    use super::*;
    #[derive(Debug, Clone, Copy, PartialEq, Eq)]
    pub struct KeyId(pub(crate) u8);
    impl KeyId {
        pub fn is_black(&self) -> bool {
            matches!(self.0 % 12, 1 | 3 | 6 | 8 | 10)
        }
        pub fn note(&self) -> u8 {
            self.0
        }
    }
    #[derive(Debug, Clone)]
    pub struct KeyboardRange {
        span: Range<u8>,
        all: Arc<[KeyId]>,
        white: Arc<[KeyId]>,
        black: Arc<[KeyId]>,
    }
    impl KeyboardRange {
        pub fn new<R: RangeBounds<u8>>(bounds: R) -> Self {
            let start = match bounds.start_bound() {
                Bound::Included(n) => *n,
                Bound::Excluded(n) => n.saturating_add(1),
                Bound::Unbounded => 0,
            }
            .min(128);
            let end = match bounds.end_bound() {
                Bound::Included(n) => n.saturating_add(1),
                Bound::Excluded(n) => *n,
                Bound::Unbounded => 128,
            }
            .min(128)
            .max(start);
            let all = (start..end).map(KeyId).collect::<Vec<_>>();
            let white = all
                .iter()
                .copied()
                .filter(|k| !k.is_black())
                .collect::<Vec<_>>();
            let black = all
                .iter()
                .copied()
                .filter(KeyId::is_black)
                .collect::<Vec<_>>();
            Self {
                span: start..end,
                all: all.into(),
                white: white.into(),
                black: black.into(),
            }
        }
        pub fn standard_88_keys() -> Self {
            Self::new(21..=108)
        }
        pub fn start(&self) -> u8 {
            self.span.start
        }
        pub fn end(&self) -> u8 {
            self.span.end
        }
        pub fn range(&self) -> &Range<u8> {
            &self.span
        }
        pub fn contains(&self, n: u8) -> bool {
            self.span.contains(&n)
        }
        pub fn count(&self) -> usize {
            self.all.len()
        }
        pub fn white_count(&self) -> usize {
            self.white.len()
        }
        pub fn black_count(&self) -> usize {
            self.black.len()
        }
        pub fn iter(&self) -> std::slice::Iter<'_, KeyId> {
            self.all.iter()
        }
        pub fn white_iter(&self) -> std::slice::Iter<'_, KeyId> {
            self.white.iter()
        }
        pub fn black_iter(&self) -> std::slice::Iter<'_, KeyId> {
            self.black.iter()
        }
    }
    impl Default for KeyboardRange {
        fn default() -> Self {
            Self::standard_88_keys()
        }
    }
}
pub use range::KeyboardRange;
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum KeyKind {
    #[default]
    Neutral,
    Sharp,
}
impl KeyKind {
    pub fn is_neutral(&self) -> bool {
        *self == Self::Neutral
    }
    pub fn is_sharp(&self) -> bool {
        *self == Self::Sharp
    }
}
#[derive(Debug, Clone, Copy)]
pub struct Sizing {
    pub neutral_width: f32,
    pub neutral_height: f32,
    pub sharp_width: f32,
    pub sharp_height: f32,
}
impl Sizing {
    pub fn new(width: f32, height: f32) -> Self {
        Self {
            neutral_width: width.max(0.),
            neutral_height: height.max(0.),
            sharp_width: width.max(0.) * 0.62,
            sharp_height: height.max(0.) * 0.64,
        }
    }
}
#[derive(Debug, Clone, Copy, Default)]
pub struct Key {
    id: usize,
    note: u8,
    x: f32,
    width: f32,
    height: f32,
    kind: KeyKind,
}
impl Key {
    pub fn id(&self) -> usize {
        self.id
    }
    pub fn note_id(&self) -> u8 {
        self.note
    }
    pub fn x(&self) -> f32 {
        self.x
    }
    pub fn size(&self) -> (f32, f32) {
        (self.width, self.height)
    }
    pub fn width(&self) -> f32 {
        self.width
    }
    pub fn height(&self) -> f32 {
        self.height
    }
    pub fn kind(&self) -> &KeyKind {
        &self.kind
    }
}
#[derive(Debug, Clone)]
pub struct KeyboardLayout {
    pub keys: Arc<[Key]>,
    pub width: f32,
    pub height: f32,
    pub sizing: Sizing,
    pub range: KeyboardRange,
}
impl KeyboardLayout {
    pub fn from_range(sizing: Sizing, range: KeyboardRange) -> Self {
        let mut keys = Vec::with_capacity(range.count());
        let slots = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
        for (id, note) in range.range().clone().enumerate() {
            let black = range::KeyId(note).is_black();
            let slot = u16::from(note / 12) * 7 + slots[(note % 12) as usize];
            let width = if black {
                sizing.sharp_width
            } else {
                sizing.neutral_width
            };
            let x = slot as f32 * sizing.neutral_width - if black { width / 2. } else { 0. };
            keys.push(Key {
                id,
                note,
                x,
                width,
                height: if black {
                    sizing.sharp_height
                } else {
                    sizing.neutral_height
                },
                kind: if black {
                    KeyKind::Sharp
                } else {
                    KeyKind::Neutral
                },
            });
        }
        let origin = keys.iter().map(|k| k.x).reduce(f32::min).unwrap_or(0.);
        let mut width = 0f32;
        for key in &mut keys {
            key.x -= origin;
            width = width.max(key.x + key.width);
        }
        Self {
            keys: keys.into(),
            width,
            height: sizing.neutral_height,
            sizing,
            range,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn standard_keyboard_and_cropped_ranges_have_consistent_key_geometry() {
        let range = KeyboardRange::standard_88_keys();
        assert_eq!(
            (range.count(), range.white_count(), range.black_count()),
            (88, 52, 36)
        );
        let keyboard = KeyboardLayout::from_range(Sizing::new(20., 100.), range);
        assert_eq!(keyboard.width, 1040.);
        assert_eq!(keyboard.keys.first().unwrap().note_id(), 21);
        assert_eq!(keyboard.keys.last().unwrap().note_id(), 108);
        assert!(
            keyboard
                .keys
                .iter()
                .all(|k| k.x() >= 0. && k.x() + k.width() <= keyboard.width)
        );
        let cropped =
            KeyboardLayout::from_range(Sizing::new(20., 100.), KeyboardRange::new(61..=66));
        assert_eq!(cropped.keys.len(), 6);
        assert!(
            cropped
                .keys
                .iter()
                .all(|k| k.x() >= 0. && k.x() + k.width() <= cropped.width)
        );
        assert_eq!(KeyboardRange::new(255..=255).count(), 0);
        assert_eq!(KeyboardRange::new(..).count(), 128);
        fn share<T: Send + Sync>() {}
        share::<KeyboardLayout>();
        share::<KeyboardRange>();
    }
}
