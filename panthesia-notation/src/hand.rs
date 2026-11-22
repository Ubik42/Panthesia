//! Which hand plays a part.
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Clone, Copy, Default, Deserialize, Eq, Hash, Ord, PartialEq, PartialOrd, Serialize,
)]
pub enum PracticePart {
    LeftHand,
    RightHand,
    #[default]
    Other,
}
