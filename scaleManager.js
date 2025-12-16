/**
 * Scale Manager for Multi-Column Dock
 * Handles dynamic scaling for HiDPI/4K displays
 */

import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

/**
 * ScaleManager - Handles dynamic scaling for HiDPI/4K displays
 */
export class ScaleManager {
    constructor(settings) {
        this._settings = settings;
    }

    /**
     * Get the effective scale factor based on display and settings
     * @returns {number} The scale factor
     */
    getScaleFactor() {
        // Check if user has set a manual scale factor
        const manualScale = this._settings.get_double('scale-factor');
        if (manualScale > 0) {
            return manualScale;
        }

        // Use GNOME Shell's built-in scale factor - this already handles HiDPI properly
        // No need to calculate our own - GNOME does this correctly
        const themeContext = St.ThemeContext.get_for_stage(global.stage);
        return themeContext?.scale_factor ?? 1.0;
    }

    /**
     * Get scaled value for a dimension (UI elements like margins, padding)
     * @param {number} baseValue - Base value to scale
     * @returns {number} Scaled value
     */
    scale(baseValue) {
        return Math.round(baseValue * this.getScaleFactor());
    }

    /**
     * Get icon size - use base setting directly, GNOME handles icon scaling
     * @returns {number} Icon size in pixels
     */
    getScaledIconSize() {
        // Return the user's icon-size setting directly
        // GNOME Shell already handles HiDPI scaling for icons internally
        return this._settings.get_int('icon-size');
    }

    /**
     * Get padding for icons - minimal scaling needed
     * @returns {number} Padding in pixels
     */
    getScaledPadding() {
        const basePadding = 8;
        return Math.round(basePadding * this.getScaleFactor());
    }

    /**
     * Get scaled font size - keep reasonable bounds
     * @param {number} baseFontSize - Base font size
     * @returns {number} Scaled font size
     */
    getScaledFontSize(baseFontSize) {
        // Don't over-scale fonts - GNOME already handles font scaling
        // Just apply a modest scale factor
        const scaleFactor = this.getScaleFactor();
        const scaled = Math.round(baseFontSize * Math.min(scaleFactor, 1.5));
        return Math.max(9, Math.min(scaled, 16)); // Tighter bounds: 9-16px
    }

    /**
     * Get scaled border radius
     * @param {number} baseRadius - Base radius
     * @returns {number} Scaled radius
     */
    getScaledBorderRadius(baseRadius) {
        return Math.round(baseRadius * this.getScaleFactor());
    }

    /**
     * Get scaled margin/spacing
     * @param {number} baseSpacing - Base spacing
     * @returns {number} Scaled spacing
     */
    getScaledSpacing(baseSpacing) {
        return Math.round(baseSpacing * this.getScaleFactor());
    }

    /**
     * Get current monitor info for debugging
     * @returns {Object|null} Monitor info object
     */
    getMonitorInfo() {
        const monitor = Main.layoutManager.primaryMonitor;
        if (monitor) {
            return {
                width: monitor.width,
                height: monitor.height,
                scaleFactor: this.getScaleFactor(),
                themeScale: St.ThemeContext.get_for_stage(global.stage)?.scale_factor || 1,
            };
        }
        return null;
    }
}
