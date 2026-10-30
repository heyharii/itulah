// No console window behind the store app on Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    store_desktop_lib::run()
}
