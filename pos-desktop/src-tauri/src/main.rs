// A counter terminal has no console behind it: on Windows the shell is started
// by the shop's autostart and a second black window on the till is one more
// thing a cashier can close by accident.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    pos_desktop_lib::run()
}
