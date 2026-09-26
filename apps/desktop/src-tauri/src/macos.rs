//! macOS window background blur and glass backing.

use std::cell::RefCell;
use std::collections::HashSet;
use std::ffi::{c_char, c_int, c_void};
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::{Mutex, OnceLock};

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::NSUserInterfaceItemIdentification;
use objc2_app_kit::{
    NSAutoresizingMaskOptions, NSColor, NSEvent, NSEventMask, NSEventPhase,
    NSTitlebarSeparatorStyle, NSVisualEffectBlendingMode, NSVisualEffectMaterial,
    NSVisualEffectState, NSVisualEffectView, NSWindow, NSWindowOrderingMode,
};
use objc2_foundation::NSString;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use tauri::{Emitter, WebviewWindow, WindowEvent};

pub const BLUR_MIN: u8 = 1;
pub const BLUR_MAX: u8 = 64;
pub const BLUR_DEFAULT: u8 = 24;

const GLASS_BACKING_ID: &str = "awen.webview-glass-backing";
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

static BLUR_RADIUS: AtomicU8 = AtomicU8::new(BLUR_DEFAULT);
static GLASS_WINDOWS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
thread_local! {
    static SCROLL_MONITOR: RefCell<Option<Retained<AnyObject>>> = const { RefCell::new(None) };
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ScrollPhaseEvent {
    phase: &'static str,
    momentum_phase: &'static str,
}

fn phase_name(phase: NSEventPhase) -> &'static str {
    if phase.contains(NSEventPhase::Began) {
        "began"
    } else if phase.contains(NSEventPhase::Changed) {
        "changed"
    } else if phase.contains(NSEventPhase::Ended) {
        "ended"
    } else if phase.contains(NSEventPhase::Cancelled) {
        "cancelled"
    } else {
        "none"
    }
}

fn install_scroll_monitor(window: &WebviewWindow) {
    let Some(number) = ns_window(window).map(|native| native.windowNumber()) else {
        return;
    };
    let event_window = window.clone();
    SCROLL_MONITOR.with(|slot| {
        if slot.borrow().is_some() {
            return;
        }
        let handler = block2::RcBlock::new(move |pointer: std::ptr::NonNull<NSEvent>| {
            let event = unsafe { pointer.as_ref() };
            if MainThreadMarker::new().is_some_and(|mtm| {
                event
                    .window(mtm)
                    .is_some_and(|native| native.windowNumber() == number)
            }) && event.hasPreciseScrollingDeltas()
            {
                let phase = phase_name(event.phase());
                let momentum_phase = phase_name(event.momentumPhase());
                if phase != "none" || momentum_phase != "none" {
                    let _ = event_window.emit(
                        "awen:scroll-phase",
                        ScrollPhaseEvent {
                            phase,
                            momentum_phase,
                        },
                    );
                }
            }
            pointer.as_ptr()
        });
        let monitor = unsafe {
            NSEvent::addLocalMonitorForEventsMatchingMask_handler(
                NSEventMask::ScrollWheel,
                &handler,
            )
        };
        *slot.borrow_mut() = monitor;
    });
}

fn remove_scroll_monitor() {
    SCROLL_MONITOR.with(|slot| {
        if let Some(monitor) = slot.borrow_mut().take() {
            unsafe { NSEvent::removeMonitor(&monitor) };
        }
    });
}

type CgsConnection = usize;
type SetBlurFn = unsafe extern "C" fn(CgsConnection, c_int, c_int) -> c_int;
type ConnectionFn = unsafe extern "C" fn() -> CgsConnection;

unsafe extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}

pub fn install(window: &WebviewWindow) {
    enable_glass(window);
    install_scroll_monitor(window);
    let event_window = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Destroyed => {
            set_glass_enabled(&event_window, false);
            remove_scroll_monitor();
        }
        _ => {}
    });
}

pub fn set_background_blur_radius(window: &WebviewWindow, radius: u8) {
    let radius = radius.clamp(BLUR_MIN, BLUR_MAX);
    BLUR_RADIUS.store(radius, Ordering::Relaxed);
    if glass_enabled(window) {
        apply_blur(window, radius);
    }
}

fn glass_windows() -> &'static Mutex<HashSet<String>> {
    GLASS_WINDOWS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn glass_enabled(window: &WebviewWindow) -> bool {
    glass_windows()
        .lock()
        .unwrap_or_else(|err| err.into_inner())
        .contains(window.label())
}

fn set_glass_enabled(window: &WebviewWindow, enabled: bool) {
    let mut windows = glass_windows()
        .lock()
        .unwrap_or_else(|err| err.into_inner());
    if enabled {
        windows.insert(window.label().to_string());
    } else {
        windows.remove(window.label());
    }
}

#[allow(dead_code)]
fn prepare_launch(window: &WebviewWindow) {
    set_launch_background(window, 23, 23, 23);
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    ns_window.setHasShadow(true);
    ns_window.invalidateShadow();
    ns_window.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
}

fn set_launch_background(window: &WebviewWindow, r: u8, g: u8, b: u8) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    set_glass_backing(&ns_window, false);
    ns_window.setOpaque(true);
    ns_window.setBackgroundColor(Some(&NSColor::colorWithRed_green_blue_alpha(
        r as f64 / 255.0,
        g as f64 / 255.0,
        b as f64 / 255.0,
        1.0,
    )));
}

pub fn enable_glass(window: &WebviewWindow) {
    set_glass_enabled(window, true);
    prepare_glass(window);
    apply_blur(window, BLUR_RADIUS.load(Ordering::Relaxed));
}

pub fn disable_glass(window: &WebviewWindow) {
    set_glass_enabled(window, false);
    apply_blur(window, 0);
    set_launch_background(window, 24, 24, 27);
}

fn prepare_glass(window: &WebviewWindow) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    set_glass_backing(&ns_window, true);
    ns_window.setOpaque(false);
    ns_window.setBackgroundColor(Some(&NSColor::clearColor().colorWithAlphaComponent(0.01)));
    ns_window.setHasShadow(true);
    ns_window.invalidateShadow();
    ns_window.setTitlebarSeparatorStyle(NSTitlebarSeparatorStyle::None);
}

fn set_glass_backing(window: &NSWindow, enabled: bool) {
    let Some(content) = window.contentView() else {
        return;
    };
    let identifier = NSString::from_str(GLASS_BACKING_ID);
    if let Some(backing) = content
        .subviews()
        .iter()
        .find(|view| view.identifier().as_deref() == Some(&identifier))
    {
        backing.setHidden(!enabled);
        return;
    }
    if !enabled {
        return;
    }

    let backing = NSVisualEffectView::initWithFrame(
        NSVisualEffectView::alloc(window.mtm()),
        content.bounds(),
    );
    backing.setIdentifier(Some(&identifier));
    backing.setMaterial(NSVisualEffectMaterial::UnderWindowBackground);
    backing.setBlendingMode(NSVisualEffectBlendingMode::BehindWindow);
    backing.setState(NSVisualEffectState::Active);
    backing.setAlphaValue(0.01);
    backing.setAutoresizingMask(
        NSAutoresizingMaskOptions::ViewWidthSizable | NSAutoresizingMaskOptions::ViewHeightSizable,
    );
    content.addSubview_positioned_relativeTo(&backing, NSWindowOrderingMode::Below, None);
}

fn apply_blur(window: &WebviewWindow, radius: u8) {
    let Some(ns_window) = ns_window(window) else {
        return;
    };
    let Some(set_blur) = set_blur_fn() else {
        return;
    };
    let Some(connection) = cgs_connection() else {
        return;
    };
    let window_number = ns_window.windowNumber();
    if window_number <= 0 {
        return;
    }
    unsafe {
        set_blur(connection, window_number as c_int, radius as c_int);
    }
}

pub(crate) fn ns_window(window: &WebviewWindow) -> Option<objc2::rc::Retained<NSWindow>> {
    let Ok(handle) = window.window_handle() else {
        return None;
    };
    let RawWindowHandle::AppKit(appkit) = handle.as_raw() else {
        return None;
    };
    let ns_view: *mut objc2::runtime::AnyObject = appkit.ns_view.as_ptr().cast();
    if ns_view.is_null() {
        return None;
    }
    let view = unsafe { &*ns_view.cast::<objc2_app_kit::NSView>() };
    view.window()
}

fn set_blur_fn() -> Option<SetBlurFn> {
    static FN: OnceLock<Option<SetBlurFn>> = OnceLock::new();
    *FN.get_or_init(|| dlsym_fn(b"CGSSetWindowBackgroundBlurRadius\0"))
}

fn cgs_connection() -> Option<CgsConnection> {
    static FN: OnceLock<Option<ConnectionFn>> = OnceLock::new();
    let function = (*FN.get_or_init(|| {
        dlsym_fn(b"CGSDefaultConnectionForThread\0").or_else(|| dlsym_fn(b"CGSMainConnectionID\0"))
    }))?;
    let connection = unsafe { function() };
    (connection != 0).then_some(connection)
}

fn dlsym_fn<T>(symbol: &[u8]) -> Option<T> {
    unsafe {
        let ptr = dlsym(RTLD_DEFAULT, symbol.as_ptr().cast());
        if ptr.is_null() {
            None
        } else {
            Some(std::mem::transmute_copy(&ptr))
        }
    }
}
