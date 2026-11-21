#![allow(clippy::collapsible_match, clippy::single_match)]

pub use dpi;
pub use panthesia_keyboard;

pub mod product;
pub mod manifest;
pub mod manifest_store;
pub mod manifest_sidecar;
pub mod practice_transform;
pub mod practice_score;
pub mod source_score_window;
mod practice_transpose;
pub mod practice_engraving;
pub mod song_project;
pub mod exercise;
pub mod fingering;
pub mod library;
pub mod song_annotations;
pub mod metadata_layers;
pub mod musicxml;
pub mod practice;
pub mod practice_history;
pub mod score_document;
pub mod score_alignment;
pub mod score_playback;
pub mod score_ornament;
pub mod score_performance;
pub mod score_view;
pub mod song_config;
pub mod utils;

pub use euclid;

pub type Point<T = f32> = euclid::default::Point2D<T>;
pub type Size<T = f32> = euclid::default::Size2D<T>;
pub type Box2D<T = f32> = euclid::default::Box2D<T>;
pub type Rect<T = f32> = euclid::default::Rect<T>;

pub mod recorder;

pub mod song_bookmarks;
