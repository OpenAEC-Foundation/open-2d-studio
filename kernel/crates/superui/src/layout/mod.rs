//! Layout chrome — TitleBar, Ribbon, FileTabBar, StatusBar.

pub mod title_bar;
pub mod ribbon;
pub mod file_tab_bar;

pub use title_bar::{TitleBar, TitleBarAction};
pub use ribbon::{Ribbon, RibbonGroup, RibbonAction, RibbonTabId, RibbonTabDef, RibbonButtonDef, ButtonSize};
pub use file_tab_bar::{FileTabBar, FileTabAction, FileTabDef};
