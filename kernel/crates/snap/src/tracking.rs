//! KeyPointTracker — collects up to 7 hover-acquired anchor points
//! (FIFO) used by SnapMode::Alignment for axis-locked tracking lines.

use crate::types::SnapMode;
use std::time::{Duration, Instant};

const MAX_KEY_POINTS: usize = 7;
const HOVER_DURATION: Duration = Duration::from_millis(250);

#[derive(Debug, Clone)]
pub struct KeyPointTracker {
    /// Currently hovered candidate + when hover started.
    hover: Option<(SnapMode, [f64; 2], Instant)>,
    /// Accepted key points (FIFO; oldest at index 0).
    points: Vec<[f64; 2]>,
}

impl KeyPointTracker {
    pub fn new() -> Self {
        Self { hover: None, points: Vec::with_capacity(MAX_KEY_POINTS) }
    }

    /// Call on every cursor frame. `hovered` = the snap result under
    /// the cursor (may be None). When the hover persists for HOVER_DURATION
    /// over an Endpoint/Midpoint/Center, the point is added.
    pub fn update(&mut self, hovered: Option<(SnapMode, [f64; 2])>, now: Instant) {
        match (self.hover, hovered) {
            (None, Some((kind, pt))) if is_acquirable(kind) => {
                self.hover = Some((kind, pt, now));
            }
            (Some((kind_was, pt_was, t)), Some((kind_now, pt_now)))
                if kind_was == kind_now && approx_eq(pt_was, pt_now)
            => {
                if now.duration_since(t) >= HOVER_DURATION {
                    self.add_point(pt_was);
                    // Reset hover so we don't add it again until the
                    // user moves away and back.
                    self.hover = None;
                }
            }
            _ => {
                self.hover = if let Some((k, p)) = hovered {
                    if is_acquirable(k) { Some((k, p, now)) } else { None }
                } else { None };
            }
        }
    }

    pub fn points(&self) -> &[[f64; 2]] {
        &self.points
    }

    pub fn clear(&mut self) {
        self.hover = None;
        self.points.clear();
    }

    fn add_point(&mut self, p: [f64; 2]) {
        // De-dup: don't add if already present (within 1e-6 world).
        if self.points.iter().any(|q| approx_eq(*q, p)) { return; }
        if self.points.len() == MAX_KEY_POINTS {
            self.points.remove(0); // FIFO eviction
        }
        self.points.push(p);
    }
}

fn is_acquirable(k: SnapMode) -> bool {
    matches!(k, SnapMode::Endpoint | SnapMode::Midpoint | SnapMode::Center)
}

fn approx_eq(a: [f64; 2], b: [f64; 2]) -> bool {
    (a[0] - b[0]).abs() < 1e-6 && (a[1] - b[1]).abs() < 1e-6
}

impl Default for KeyPointTracker {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fifo_eviction_caps_at_7() {
        let mut t = KeyPointTracker::new();
        for i in 0..10 {
            t.add_point([i as f64, 0.0]);
        }
        assert_eq!(t.points.len(), 7);
        // First 3 evicted; should start at index 3.
        assert_eq!(t.points[0], [3.0, 0.0]);
        assert_eq!(t.points[6], [9.0, 0.0]);
    }

    #[test]
    fn dedupe_within_epsilon() {
        let mut t = KeyPointTracker::new();
        t.add_point([1.0, 2.0]);
        t.add_point([1.0_f64 + 1e-9, 2.0]);
        assert_eq!(t.points.len(), 1);
    }

    #[test]
    fn requires_hover_duration_before_acquire() {
        let mut t = KeyPointTracker::new();
        let t0 = Instant::now();
        t.update(Some((SnapMode::Endpoint, [5.0, 5.0])), t0);
        assert!(t.points.is_empty(), "first hover frame doesn't acquire");
        t.update(Some((SnapMode::Endpoint, [5.0, 5.0])), t0 + Duration::from_millis(100));
        assert!(t.points.is_empty(), "100ms later still not acquired");
        t.update(Some((SnapMode::Endpoint, [5.0, 5.0])), t0 + Duration::from_millis(300));
        assert_eq!(t.points.len(), 1, "after 300ms acquired");
        assert_eq!(t.points[0], [5.0, 5.0]);
    }
}
