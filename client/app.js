/**
 * Bus Stops Client Application
 * Handles UI interactions, API calls, and geolocation
 */

(function() {
    'use strict';

    // API Base URL (same origin)
    const API_BASE = '/api';

    // Application State
    const state = {
        regions: [],
        stops: [],
        buses: [],
        selectedRegion: null,
        selectedStop: null,
        selectedBus: null,
        userLocation: null
    };

    // DOM Elements
    const elements = {
        // Inputs
        regionInput: $('#regionInput'),
        stopInput: $('#stopInput'),

        // Buttons
        btnLoadStops: $('#btnLoadStops'),
        btnLoadBuses: $('#btnLoadBuses'),
        btnClear: $('#btnClear'),

        // Status/Info
        locationStatus: $('#locationStatus'),
        locationText: $('#locationText'),
        stopInfo: $('#stopInfo'),
        stopCode: $('#stopCode'),
        stopCoords: $('#stopCoords'),
        busCount: $('#busCount'),
        serverTime: $('#serverTime'),

        // Buses
        busesLoading: $('#busesLoading'),
        busesEmpty: $('#busesEmpty'),
        busesContainer: $('#busesContainer'),
        busesList: $('#busesList'),

        // Arrivals
        arrivalsLoading: $('#arrivalsLoading'),
        arrivalsEmpty: $('#arrivalsEmpty'),
        arrivalsContainer: $('#arrivalsContainer'),
        arrivalsHeader: $('#arrivalsHeader'),
        arrivalsList: $('#arrivalsList'),
        noArrivals: $('#noArrivals'),
        selectedRoute: $('#selectedRoute'),
        selectedStopName: $('#selectedStopName'),
        arrivalsInfo: $('#arrivalsInfo')
    };

    /**
     * Natural sort comparator for bus route numbers
     */
    function naturalRouteSort(a, b) {
        const regex = /^(\d*)(\D*)$/;
        const matchA = a.match(regex) || ['', a, ''];
        const matchB = b.match(regex) || ['', b, ''];

        const numA = matchA[1] ? parseInt(matchA[1], 10) : Infinity;
        const numB = matchB[1] ? parseInt(matchB[1], 10) : Infinity;

        if (numA !== numB) {
            return numA - numB;
        }

        return (matchA[2] || '').localeCompare(matchB[2] || '');
    }

    /**
     * API call helper
     */
    async function apiCall(endpoint, params = {}) {
        const url = new URL(API_BASE + endpoint, window.location.origin);
        Object.keys(params).forEach(key => {
            if (params[key] !== undefined && params[key] !== null) {
                url.searchParams.append(key, params[key]);
            }
        });

        const response = await fetch(url);
        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || 'API request failed');
        }

        return data;
    }

    /**
     * Load regions from server
     */
    async function loadRegions() {
        try {
            const result = await apiCall('/regions');
            state.regions = result.data || [];

            // Initialize autocomplete for regions
            elements.regionInput.autocomplete({
                source: state.regions,
                minLength: 0,
                select: function(event, ui) {
                    state.selectedRegion = ui.item.value;
                    elements.btnLoadStops.prop('disabled', false);
                    // Auto-clear dependent fields when region changes
                    clearStops();
                    clearBuses();
                    clearArrivals();
                }
            }).on('focus', function() {
                // Show dropdown on focus
                if (state.regions.length > 0) {
                    $(this).autocomplete('search', '');
                }
            });

            // Enable input when data is ready
            elements.regionInput.prop('disabled', false);

            console.log(`Loaded ${state.regions.length} regions`);
        } catch (error) {
            console.error('Failed to load regions:', error);
            showError('Piirkondade laadimine ebaõnnestus');
        }
    }

    /**
     * Load stops for selected region
     */
    async function loadStops(region) {
        if (!region) {
            region = state.selectedRegion || elements.regionInput.val();
        }

        if (!region) {
            showError('Vali esmalt piirkond');
            return;
        }

        try {
            elements.stopInput.prop('disabled', true);
            const result = await apiCall('/stops', { region });
            state.stops = result.data || [];

            // Initialize autocomplete for stops
            const stopOptions = state.stops.map(stop => ({
                label: `${stop.stop_name} (${stop.stop_code || stop.stop_id})`,
                value: stop.stop_name,
                stop: stop
            }));

            elements.stopInput.autocomplete('destroy');
            elements.stopInput.autocomplete({
                source: stopOptions,
                minLength: 0,
                select: function(event, ui) {
                    state.selectedStop = ui.item.stop;
                    elements.btnLoadBuses.prop('disabled', false);
                    showStopInfo(ui.item.stop);
                    clearBuses();
                    clearArrivals();
                }
            }).on('focus', function() {
                if (state.stops.length > 0) {
                    $(this).autocomplete('search', '');
                }
            });

            elements.stopInput.prop('disabled', false);
            elements.stopInput.attr('placeholder', 'Sisesta või vali peatus...');

            console.log(`Loaded ${state.stops.length} stops for ${region}`);
        } catch (error) {
            console.error('Failed to load stops:', error);
            showError('Peatuste laadimine ebaõnnestus');
        }
    }

    /**
     * Load buses for selected stop
     */
    async function loadBuses(stopId) {
        if (!stopId) {
            if (!state.selectedStop) {
                showError('Vali esmalt peatus');
                return;
            }
            stopId = state.selectedStop.stop_id;
        }

        try {
            showBusesLoading(true);

            const result = await apiCall('/buses', { stopId });
            state.buses = (result.data || []).sort(naturalRouteSort);

            renderBuses();
            console.log(`Loaded ${state.buses.length} buses for stop ${stopId}`);
        } catch (error) {
            console.error('Failed to load buses:', error);
            showError('Busside laadimine ebaõnnestus');
            showBusesLoading(false);
        }
    }

    /**
     * Load arrivals for selected bus at stop
     */
    async function loadArrivals(route) {
        if (!state.selectedStop) {
            showError('Vali esmalt peatus');
            return;
        }

        try {
            showArrivalsLoading(true);
            state.selectedBus = route;

            const result = await apiCall('/arrivals', {
                stopId: state.selectedStop.stop_id,
                route: route
            });

            renderArrivals(result);

            // Update server time display
            if (result.currentTime && result.currentDate) {
                elements.serverTime.text(`Serveriaeg: ${result.currentDate} ${result.currentTime}`);
            }

            console.log(`Loaded ${result.count} arrivals for ${route} at ${state.selectedStop.stop_name}`);
        } catch (error) {
            console.error('Failed to load arrivals:', error);
            showError('Saabumisaegade laadimine ebaõnnestus');
            showArrivalsLoading(false);
        }
    }

    /**
     * Find nearest stop to user location
     */
    async function findNearestStop(lat, lon) {
        try {
            const result = await apiCall('/nearest', { lat, lon });
            return result.data;
        } catch (error) {
            console.error('Failed to find nearest stop:', error);
            return null;
        }
    }

    /**
     * Get user geolocation
     */
    function getUserLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                position => {
                    resolve({
                        lat: position.coords.latitude,
                        lon: position.coords.longitude
                    });
                },
                error => {
                    reject(error);
                },
                {
                    enableHighAccuracy: true,
                    timeout: 10000,
                    maximumAge: 60000
                }
            );
        });
    }

    /**
     * Initialize with user location
     */
    async function initWithGeolocation() {
        elements.locationStatus.removeClass('d-none');
        elements.locationText.text('Asukoha tuvastamine...');

        try {
            // Get user location
            const location = await getUserLocation();
            state.userLocation = location;

            elements.locationText.html(
                `<i class="bi bi-check-circle me-1"></i>Asukoht leitud: ${location.lat.toFixed(5)}, ${location.lon.toFixed(5)}`
            );
            elements.locationStatus.removeClass('alert-info').addClass('alert-success');

            // Find nearest stop
            const nearestStop = await findNearestStop(location.lat, location.lon);

            if (nearestStop) {
                elements.locationText.html(
                    `<i class="bi bi-check-circle me-1"></i>Lähim peatus: <strong>${nearestStop.stop_name}</strong> (${nearestStop.distance_km} km)`
                );

                // Auto-fill region
                if (nearestStop.region && state.regions.includes(nearestStop.region)) {
                    elements.regionInput.val(nearestStop.region);
                    state.selectedRegion = nearestStop.region;
                    elements.btnLoadStops.prop('disabled', false);

                    // Load stops for this region
                    await loadStops(nearestStop.region);

                    // Auto-select the nearest stop
                    const matchingStop = state.stops.find(s => s.stop_id === nearestStop.stop_id);
                    if (matchingStop) {
                        state.selectedStop = matchingStop;
                        elements.stopInput.val(matchingStop.stop_name);
                        elements.btnLoadBuses.prop('disabled', false);
                        showStopInfo(matchingStop);

                        // Auto-load buses
                        await loadBuses(matchingStop.stop_id);
                    }
                }

                // Hide location status after a delay
                setTimeout(() => {
                    elements.locationStatus.addClass('d-none');
                }, 5000);
            }
        } catch (error) {
            console.log('Geolocation unavailable:', error.message);
            elements.locationText.html(
                `<i class="bi bi-exclamation-triangle me-1"></i>Asukoha tuvastamine ebaõnnestus. Vali piirkond käsitsi.`
            );
            elements.locationStatus.removeClass('alert-info').addClass('alert-warning');

            // Hide after delay
            setTimeout(() => {
                elements.locationStatus.addClass('d-none');
            }, 5000);
        }
    }

    /**
     * Show stop information
     */
    function showStopInfo(stop) {
        if (!stop) {
            elements.stopInfo.addClass('d-none');
            return;
        }

        elements.stopCode.text(`ID: ${stop.stop_code || stop.stop_id}`);
        elements.stopCoords.text(`${stop.stop_lat}, ${stop.stop_lon}`);
        elements.stopInfo.removeClass('d-none');
    }

    /**
     * Render buses list
     */
    function renderBuses() {
        showBusesLoading(false);

        if (state.buses.length === 0) {
            elements.busesContainer.addClass('d-none');
            elements.busesEmpty.removeClass('d-none').text('Sellel peatusel busse ei leitud');
            elements.busCount.addClass('d-none');
            return;
        }

        elements.busesEmpty.addClass('d-none');
        elements.busesContainer.removeClass('d-none');
        elements.busCount.removeClass('d-none').text(state.buses.length);

        const html = state.buses.map(bus => {
            const isActive = state.selectedBus === bus ? 'active' : '';
            return `<button type="button" class="btn btn-outline-primary bus-btn ${isActive}" data-route="${escapeHtml(bus)}">${escapeHtml(bus)}</button>`;
        }).join('');

        elements.busesList.html(html);
    }

    /**
     * Render arrivals list
     */
    function renderArrivals(result) {
        showArrivalsLoading(false);
        elements.arrivalsEmpty.addClass('d-none');
        elements.arrivalsContainer.removeClass('d-none');

        elements.selectedRoute.text(state.selectedBus);
        elements.selectedStopName.text(state.selectedStop.stop_name);
        elements.arrivalsInfo.text(
            `Peatus: ${result.stop.stop_code || result.stop.stop_id} | ` +
            `Koordinaadid: ${result.stop.stop_lat}, ${result.stop.stop_lon}`
        );

        const arrivals = result.data || [];

        if (arrivals.length === 0) {
            elements.arrivalsList.empty();
            elements.noArrivals.removeClass('d-none');
            return;
        }

        elements.noArrivals.addClass('d-none');

        const html = arrivals.map((arr, index) => {
            const dateClass = arr.dateLabel === 'Täna' ? 'bg-success' :
                              arr.dateLabel === 'Homme' ? 'bg-warning text-dark' : 'bg-secondary';
            const headsign = arr.headsign ? `<span class="text-muted small"> ${escapeHtml(arr.headsign)}</span>` : '';
            const direction = arr.direction !== null && arr.direction !== undefined ?
                `<span class="badge bg-light text-dark ms-2">Suund ${arr.direction}</span>` : '';

            return `
                <div class="arrival-item d-flex align-items-center justify-content-between py-2 ${index < arrivals.length - 1 ? 'border-bottom' : ''}">
                    <div>
                        <span class="badge ${dateClass} me-2">${escapeHtml(arr.dateLabel)}</span>
                        <strong class="fs-5">${escapeHtml(arr.time)}</strong>
                        ${direction}
                    </div>
                    <div class="text-end">
                        ${headsign}
                    </div>
                </div>
            `;
        }).join('');

        elements.arrivalsList.html(html);

        // Highlight selected bus button
        elements.busesList.find('.bus-btn').removeClass('active');
        elements.busesList.find(`[data-route="${state.selectedBus}"]`).addClass('active');
    }

    /**
     * Show/hide buses loading state
     */
    function showBusesLoading(show) {
        if (show) {
            elements.busesLoading.removeClass('d-none');
            elements.busesEmpty.addClass('d-none');
            elements.busesContainer.addClass('d-none');
        } else {
            elements.busesLoading.addClass('d-none');
        }
    }

    /**
     * Show/hide arrivals loading state
     */
    function showArrivalsLoading(show) {
        if (show) {
            elements.arrivalsLoading.removeClass('d-none');
            elements.arrivalsEmpty.addClass('d-none');
            elements.arrivalsContainer.addClass('d-none');
        } else {
            elements.arrivalsLoading.addClass('d-none');
        }
    }

    /**
     * Clear stops selection
     */
    function clearStops() {
        state.stops = [];
        state.selectedStop = null;
        elements.stopInput.val('');
        elements.stopInput.prop('disabled', true);
        elements.stopInput.attr('placeholder', 'Vali esmalt piirkond...');
        elements.btnLoadBuses.prop('disabled', true);
        elements.stopInfo.addClass('d-none');
    }

    /**
     * Clear buses
     */
    function clearBuses() {
        state.buses = [];
        state.selectedBus = null;
        elements.busesList.empty();
        elements.busesContainer.addClass('d-none');
        elements.busesEmpty.removeClass('d-none').text('Vali peatus busside nägemiseks');
        elements.busCount.addClass('d-none');
    }

    /**
     * Clear arrivals
     */
    function clearArrivals() {
        elements.arrivalsContainer.addClass('d-none');
        elements.arrivalsEmpty.removeClass('d-none');
        elements.arrivalsList.empty();
    }

    /**
     * Clear all selections
     */
    function clearAll() {
        state.selectedRegion = null;
        state.selectedStop = null;
        state.selectedBus = null;

        elements.regionInput.val('');
        elements.btnLoadStops.prop('disabled', true);

        clearStops();
        clearBuses();
        clearArrivals();
    }

    /**
     * Show error message
     */
    function showError(message) {
        // Simple alert for now, could be replaced with toast
        console.error(message);
        // Could implement a toast notification here
    }

    /**
     * Escape HTML special characters
     */
    function escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Initialize event handlers
     */
    function initEventHandlers() {
        // Load stops button
        elements.btnLoadStops.on('click', function() {
            const region = elements.regionInput.val();
            if (region) {
                state.selectedRegion = region;
                loadStops(region);
            }
        });

        // Load buses button
        elements.btnLoadBuses.on('click', function() {
            loadBuses();
        });

        // Clear button
        elements.btnClear.on('click', clearAll);

        // Region input change - clear dependent fields
        elements.regionInput.on('input', function() {
            const val = $(this).val();
            if (val !== state.selectedRegion) {
                clearStops();
                clearBuses();
                clearArrivals();
                elements.btnLoadStops.prop('disabled', !val);
            }
        });

        // Stop input change
        elements.stopInput.on('input', function() {
            const val = $(this).val();
            if (!val) {
                state.selectedStop = null;
                elements.btnLoadBuses.prop('disabled', true);
                elements.stopInfo.addClass('d-none');
            }
        });

        // Bus button click (event delegation)
        elements.busesList.on('click', '.bus-btn', function() {
            const route = $(this).data('route');
            if (route) {
                loadArrivals(route);
            }
        });

        // Enter key handlers
        elements.regionInput.on('keypress', function(e) {
            if (e.which === 13) {
                e.preventDefault();
                elements.btnLoadStops.click();
            }
        });

        elements.stopInput.on('keypress', function(e) {
            if (e.which === 13) {
                e.preventDefault();
                elements.btnLoadBuses.click();
            }
        });
    }

    /**
     * Initialize application
     */
    async function init() {
        console.log('Initializing Bus Stops App...');

        // Initialize event handlers
        initEventHandlers();

        // Load regions
        await loadRegions();

        // Try to get user location and auto-fill
        initWithGeolocation();
    }

    // Start application when DOM is ready
    $(document).ready(init);

})();
