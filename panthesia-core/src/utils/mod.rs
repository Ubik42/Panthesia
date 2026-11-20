pub mod atomic_file;
#[cfg(feature = "native-render")]
pub mod fps_ticker;
#[cfg(feature = "native-render")]
pub mod resources;

pub type Rect<T = f32> = euclid::default::Rect<T>;
pub type Point<T = f32> = euclid::default::Point2D<T>;
pub type Size<T = f32> = euclid::default::Size2D<T>;
