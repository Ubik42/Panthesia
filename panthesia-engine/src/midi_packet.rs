//! Ordinary keyboard events travel inline; long MIDI messages retain their original bytes.
pub(crate) enum Packet {
    Short([u8; 3], u8),
    Long(Box<[u8]>),
}
impl Packet {
    pub fn new(bytes: &[u8]) -> Self {
        if bytes.len() <= 3 {
            let mut data = [0; 3];
            data[..bytes.len()].copy_from_slice(bytes);
            Self::Short(data, bytes.len() as u8)
        } else {
            Self::Long(bytes.into())
        }
    }
    pub fn bytes(&self) -> &[u8] {
        match self {
            Self::Short(data, len) => &data[..usize::from(*len)],
            Self::Long(data) => data,
        }
    }
}
