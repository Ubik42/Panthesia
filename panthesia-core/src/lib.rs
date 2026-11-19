#![allow(clippy::collapsible_match, clippy::single_match)]

pub use dpi;
pub use piano_layout;
#[cfg(feature = "native-render")]
pub use wgpu_jumpstart::{Color, Gpu, TransformUniform, Uniform};

pub mod config;
pub mod product;
pub mod practice_transform;
pub mod practice_score;
pub mod song_project;
pub mod song_catalog;
pub mod exercise;
pub mod fingering;
#[cfg(feature = "native-render")]
pub mod font_system;
pub mod library;
pub mod metadata_layers;
pub mod synthesia_metadata;
pub mod musicxml;
pub mod practice;
pub mod practice_history;
pub mod speed_ladder;
#[cfg(feature = "native-render")]
pub mod render;
pub mod repertoire;
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
