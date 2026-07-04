/**
 * Window Tiling Control — src/i18n.js
 * Lightweight gettext wrapper.
 * Call setExtensionObject(ext) once in extension.js enable().
 */

let _ext = null;

export function setExtensionObject(ext) {
    _ext = ext;
}

/**
 * Translate a string using the extension's gettext domain.
 * Falls back to the raw string if the extension is not yet set.
 */
export function _(str) {
    if (_ext)
        return _ext.gettext(str);
    return str;
}

/**
 * Translate a string with a plural form.
 */
export function ngettext(singular, plural, n) {
    if (_ext)
        return _ext.ngettext(singular, plural, n);
    return n === 1 ? singular : plural;
}
