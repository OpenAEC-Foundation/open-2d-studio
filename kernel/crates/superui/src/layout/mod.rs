//! Layout chrome — TitleBar, Ribbon, FileTabBar, StatusBar.

pub mod title_bar;
pub mod ribbon;

pub use title_bar::{TitleBar, TitleBarAction};
pub use ribbon::{Ribbon, RibbonGroup, RibbonAction, RibbonTabId, RibbonTabDef, RibbonButtonDef, ButtonSize};
