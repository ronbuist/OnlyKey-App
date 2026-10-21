/* Simple interface for localStorage */

if (typeof nw === 'undefined') return;

let onlyKeyAppUserPreferences; // singleton

(function() {
    'use strict';

    class UserPreferences {
        constructor(params = {}) {
            const keys = ['autoLaunch', 'autoUpdate', 'autoUpdateFW'];
            keys.forEach(key => this[`_${key}`] = this.getPropVal(key));
        }

        get autoUpdateFW() {
            return this.getPropVal('autoUpdateFW');
        }

        set autoUpdateFW(value) {
            this._autoUpdateFW = getBoolean(value);
            setStored('autoUpdateFW', getBooleanString(value));
        }

        get autoLaunch() {
            return this.getPropVal('autoLaunch');
        }

        set autoLaunch(value) {
            this._autoLaunch = getBoolean(value);
            setStored('autoLaunch', getBooleanString(value));
        }

        get autoUpdate() {
            return this.getPropVal('autoUpdate');
        }

        set autoUpdate(value) {
            this._autoUpdate = getBoolean(value);
            setStored('autoUpdate', getBooleanString(value));
        }

        getPropVal(key) {
            if (this.hasOwnProperty(`_${key}`)) {
                return this[`_${key}`];
            } else if (this.hasStoredValue(key)) {
                return getBoolean(getStorage().getItem(key));
            } else {
                return true;
            }
        }
    }

    UserPreferences.prototype.hasStoredValue = function (key) {
        const storage = getStorage();
        return !!storage && storage.getItem(key) !== null;
    };

    onlyKeyAppUserPreferences = onlyKeyAppUserPreferences || new UserPreferences();
    if (module && module.exports) {
        module.exports = onlyKeyAppUserPreferences;
    } else {
        return onlyKeyAppUserPreferences;
    }

    /* private helpers */

    // This file is loaded with require(), so it runs in Node's context. Newer
    // Node versions (NW.js 0.1xx) have their own, usually unavailable,
    // `localStorage` global there, so look up the page's DOM storage explicitly.
    function getStorage() {
        const candidates = [
            () => typeof window !== 'undefined' && window.localStorage,
            () => typeof nw !== 'undefined' && nw.Window.get().window.localStorage,
            () => typeof localStorage !== 'undefined' && localStorage,
        ];
        for (const candidate of candidates) {
            try {
                const storage = candidate();
                if (storage && typeof storage.getItem === 'function') return storage;
            } catch (e) {
                /* try the next one */
            }
        }
        return null;
    }

    function setStored(key, value) {
        const storage = getStorage();
        if (storage) storage.setItem(key, value);
    }
    function getBoolean(value) {
        if (value === 'false' || !value) {
            return false;
        }

        return true;
    }

    function getBooleanString(value) {
        if (value === 'false' || !value) {
            return 'false';
        }

        return 'true';
    }
})();
