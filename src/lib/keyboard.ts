const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform ?? navigator.userAgent);

export function hasPrimaryModifier(event: KeyboardEvent): boolean {
    return !event.altKey && !event.shiftKey
        && (isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey);
}

export function hasKeyboardOverlay(): boolean {
    return !!document.querySelector(
        "[role='dialog']:not([data-state='closed']), [role='alertdialog']:not([data-state='closed']), "
        + "[role='menu']:not([data-state='closed']), [role='listbox']:not([data-state='closed'])",
    );
}
