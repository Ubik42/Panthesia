//! Immutable map snapshots share each entry as well as their index.
//! Updating one daily plan does not copy every archived plan and its items.
use serde::{Deserialize, Serialize, ser::SerializeMap};
use std::{borrow::Borrow, collections::BTreeMap, sync::Arc};

pub(crate) struct SharedMap<K, V>(Arc<BTreeMap<K, Arc<V>>>);
impl<K, V> Clone for SharedMap<K, V> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}
impl<K, V> Default for SharedMap<K, V> {
    fn default() -> Self {
        Self(Arc::new(BTreeMap::new()))
    }
}
impl<K: Ord, V> From<BTreeMap<K, V>> for SharedMap<K, V> {
    fn from(map: BTreeMap<K, V>) -> Self {
        Self(Arc::new(
            map.into_iter()
                .map(|(key, value)| (key, Arc::new(value)))
                .collect(),
        ))
    }
}
impl<K: Ord, V> SharedMap<K, V> {
    pub fn same_snapshot(&self, other: &Self) -> bool {
        Arc::ptr_eq(&self.0, &other.0)
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    pub fn get<Q: Ord + ?Sized>(&self, key: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
    {
        self.0.get(key).map(Arc::as_ref)
    }
    pub fn contains_key<Q: Ord + ?Sized>(&self, key: &Q) -> bool
    where
        K: Borrow<Q>,
    {
        self.0.contains_key(key)
    }
    pub fn values(&self) -> impl DoubleEndedIterator<Item = &V> + ExactSizeIterator {
        self.0.values().map(Arc::as_ref)
    }
    pub fn iter(&self) -> impl DoubleEndedIterator<Item = (&K, &V)> + ExactSizeIterator {
        self.0.iter().map(|(key, value)| (key, value.as_ref()))
    }
}
impl<K: Ord + Clone, V: Clone> SharedMap<K, V> {
    pub fn get_mut<Q: Ord + ?Sized>(&mut self, key: &Q) -> Option<&mut V>
    where
        K: Borrow<Q>,
    {
        if !self.0.contains_key(key) {
            return None;
        }
        Arc::make_mut(&mut self.0).get_mut(key).map(Arc::make_mut)
    }
    pub fn insert(&mut self, key: K, value: V) -> Option<V> {
        Arc::make_mut(&mut self.0)
            .insert(key, Arc::new(value))
            .map(Arc::unwrap_or_clone)
    }
    /// Full copies belong to exports, not playback-side snapshot capture.
    pub fn materialize(&self) -> BTreeMap<K, V> {
        self.iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()
    }
}
impl<K: Ord + Borrow<Q>, Q: Ord + ?Sized, V> std::ops::Index<&Q> for SharedMap<K, V> {
    type Output = V;
    fn index(&self, key: &Q) -> &V {
        self.get(key).expect("missing shared map entry")
    }
}
impl<K: Ord + Serialize, V: Serialize> Serialize for SharedMap<K, V> {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut map = serializer.serialize_map(Some(self.len()))?;
        for (key, value) in self.iter() {
            map.serialize_entry(key, value)?;
        }
        map.end()
    }
}
impl<'de, K: Ord + Deserialize<'de>, V: Deserialize<'de>> Deserialize<'de> for SharedMap<K, V> {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        BTreeMap::<K, V>::deserialize(deserializer).map(Self::from)
    }
}
