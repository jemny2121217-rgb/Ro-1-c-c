/*
 * Rydo — Move your way.
 * Main application script
 *
 * Enhancements:
 * - Pickup by browser GPS ("Use my location")
 * - Destination geocoding (Mapbox) when MAPBOX_ACCESS_TOKEN is set
 * - Road distance via Mapbox Directions API when MAPBOX_ACCESS_TOKEN is set
 * - Fallback to straight-line distance if no API token provided
 * - Automatic fare calculation and UI updates when destination or vehicle type changes
 * - Adds hidden fields rideDistance and rideFare to the form before submit so server-side (e.g., Supabase) can receive them
 */

/* CONFIGURATION: set your Mapbox access token here to enable geocoding & routing.
   - If empty, the script will fall back to straight-line distances (approximate).
   - Mapbox docs: https://docs.mapbox.com/api/
*/
const MAPBOX_ACCESS_TOKEN = ''; // <-- add your Mapbox token here

// Fare rules (Rs)
const FARE_RULES = {
  bike: { base: 25, perKm: 14 },
  car: { base: 60, perKm: 25 },
  tuktuk: { base: 45, perKm: 18 }
};

// Utility: debounce
function debounce(fn, wait) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// Set current year in footer
function setCurrentYear() {
  const yearElement = document.getElementById('year');
  if (yearElement) {
    yearElement.textContent = new Date().getFullYear();
  }
}

// Modal management - generic modal
function openModal(title, message) {
  const modal = document.getElementById('modal');
  const modalTitle = document.getElementById('modal-title');
  const modalMessage = document.getElementById('modal-message');

  if (modal && modalTitle && modalMessage) {
    modalTitle.textContent = title;
    modalMessage.textContent = message;
    modal.setAttribute('aria-hidden', 'false');
  }
}

function closeModal() {
  const modal = document.getElementById('modal');
  if (modal) {
    modal.setAttribute('aria-hidden', 'true');
  }
}

// Ride request modal management
function openRideRequestModal() {
  const rideRequestModal = document.getElementById('rideRequestModal');
  if (rideRequestModal) {
    rideRequestModal.setAttribute('aria-hidden', 'false');
  }
}

function closeRideRequestModal() {
  const rideRequestModal = document.getElementById('rideRequestModal');
  if (rideRequestModal) {
    rideRequestModal.setAttribute('aria-hidden', 'true');
  }
}

// Build or update hidden input on the form
function setHiddenInput(name, value) {
  let el = document.getElementById(name);
  if (!el) {
    el = document.createElement('input');
    el.type = 'hidden';
    el.id = name;
    el.name = name;
    const form = document.getElementById('rideRequestForm');
    if (form) form.appendChild(el);
  }
  el.value = value;
}

// Haversine formula (straight-line) distance in kilometers
function haversineKm(lat1, lon1, lat2, lon2) {
  function toRad(deg) { return (deg * Math.PI) / 180; }
  const R = 6371; // Earth radius km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Mapbox geocode (forward) -> returns {lat, lon} or null
async function geocodeAddress(address) {
  if (!MAPBOX_ACCESS_TOKEN) return null;
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${MAPBOX_ACCESS_TOKEN}&limit=1`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Geocoding failed');
    const data = await res.json();
    if (data && data.features && data.features.length) {
      const [lon, lat] = data.features[0].center;
      return { lat, lon };
    }
  } catch (e) {
    console.warn('Geocoding error:', e);
  }
  return null;
}

// Mapbox directions -> returns distance in kilometers (road distance) or null
async function getDrivingDistanceKm(fromLon, fromLat, toLon, toLat) {
  if (!MAPBOX_ACCESS_TOKEN) return null;
  // Mapbox Directions API (driving)
  const coords = `${fromLon},${fromLat};${toLon},${toLat}`;
  const url = `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?access_token=${MAPBOX_ACCESS_TOKEN}&overview=false&geometries=polyline&annotations=distance`;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Directions request failed');
    const data = await res.json();
    if (data && data.routes && data.routes.length) {
      // distance in meters
      const meters = data.routes[0].distance;
      return meters / 1000;
    }
  } catch (e) {
    console.warn('Directions error:', e);
  }
  return null;
}

// Calculate fare from distance (km) and ride type
function calculateFare(distanceKm, rideType) {
  const rule = FARE_RULES[rideType] || FARE_RULES.car;
  // distanceKm might be NaN; coerce to 0
  const km = Math.max(0, Number(distanceKm) || 0);
  const fare = Math.max(0, Math.round(rule.base + rule.perKm * km));
  return fare;
}

// Update distance & fare display when possible
async function updateDistanceAndFare({ source = 'auto' } = {}) {
  const pickupLat = parseFloat(document.getElementById('pickupLat').value || '');
  const pickupLon = parseFloat(document.getElementById('pickupLon').value || '');
  const dropoffLatEl = document.getElementById('dropoffLat');
  const dropoffLonEl = document.getElementById('dropoffLon');
  const dropoffLat = parseFloat(dropoffLatEl ? dropoffLatEl.value : '');
  const dropoffLon = parseFloat(dropoffLonEl ? dropoffLonEl.value : '');

  const distanceDisplay = document.getElementById('distanceDisplay');
  const fareDisplay = document.getElementById('fareDisplay');
  const rideType = document.getElementById('rideType').value;

  // If destination input is an address and we have no coords yet and Mapbox is configured, attempt geocode
  const dropoffInput = document.getElementById('dropoff').value.trim();
  if ((!dropoffLatEl || !dropoffLatEl.value) && dropoffInput && MAPBOX_ACCESS_TOKEN) {
    // attempt geocode
    const geo = await geocodeAddress(dropoffInput);
    if (geo) {
      if (dropoffLatEl) { dropoffLatEl.value = geo.lat; }
      if (dropoffLonEl) { dropoffLonEl.value = geo.lon; }
    }
  }

  // Need both pickup & dropoff coords to compute road distance. If either missing, try fallback if possible.
  let distanceKm = null;
  let usedRoadDistance = false;

  if (!isNaN(pickupLat) && !isNaN(pickupLon) && !isNaN(dropoffLat) && !isNaN(dropoffLon)) {
    // Prefer road distance via Mapbox if configured
    if (MAPBOX_ACCESS_TOKEN) {
      const routeKm = await getDrivingDistanceKm(pickupLon, pickupLat, dropoffLon, dropoffLat);
      if (routeKm !== null) {
        distanceKm = routeKm;
        usedRoadDistance = true;
      }
    }
    // If Mapbox not configured or directions failed, fallback to haversine
    if (distanceKm === null) {
      distanceKm = haversineKm(pickupLat, pickupLon, dropoffLat, dropoffLon);
    }
  }

  if (distanceKm === null || isNaN(distanceKm)) {
    distanceDisplay.textContent = 'Distance: —';
    fareDisplay.textContent = 'Estimated Fare: Rs —';
    setHiddenInput('rideDistance', '');
    setHiddenInput('rideFare', '');
    return;
  }

  // Display distance and fare
  distanceDisplay.textContent = `Distance: ${distanceKm.toFixed(2)} km${usedRoadDistance ? '' : ' (approx)'}`;
  const fare = calculateFare(distanceKm, rideType);
  fareDisplay.textContent = `Estimated Fare: Rs ${fare}`;

  // Update hidden inputs for the server
  setHiddenInput('rideDistance', distanceKm.toFixed(2));
  setHiddenInput('rideFare', fare);
}

// Handle ride request form submission
function handleRideRequestSubmit(event) {
  event.preventDefault();

  // Ensure hidden rideDistance/rideFare are created before reading values
  // (They are created/updated by updateDistanceAndFare; call once more to be safe)
  updateDistanceAndFare({ source: 'submit' }).then(() => {
    const pickup = document.getElementById('pickup').value;
    const dropoff = document.getElementById('dropoff').value;
    const rideType = document.getElementById('rideType').value;
    const passengers = document.getElementById('passengers').value;
    const notes = document.getElementById('notes').value;
    const distance = document.getElementById('rideDistance') ? document.getElementById('rideDistance').value : '—';
    const fare = document.getElementById('rideFare') ? document.getElementById('rideFare').value : '—';

    // Show confirmation modal (keeps previous behavior)
    const message =
      `Ride requested!\nPickup: ${pickup}\nDropoff: ${dropoff}\nType: ${rideType}\nPassengers: ${passengers}${notes ? '\nNotes: ' + notes : ''}\nDistance: ${distance} km\nEstimated Fare: Rs ${fare}`;
    openModal('Ride Requested', message);

    // Note: original code resets the form. Keep that behavior to avoid breaking existing flows.
    const form = document.getElementById('rideRequestForm');
    if (form) {
      form.reset();
    }
    closeRideRequestModal();
  }).catch((err) => {
    console.error('Error computing distance before submit', err);
    openModal('Error', 'Could not compute distance/fare — your request was not submitted. Please try again.');
  });
}

// Button event listeners
function initializeButtonHandlers() {
  const requestRideBtn = document.getElementById('requestRide');
  const driverBtn = document.getElementById('driverBtn');
  const modalCloseBtn = document.getElementById('modalClose');
  const rideCancelBtn = document.getElementById('rideCancel');
  const rideRequestForm = document.getElementById('rideRequestForm');

  if (requestRideBtn) {
    requestRideBtn.addEventListener('click', openRideRequestModal);
  }

  if (driverBtn) {
    driverBtn.addEventListener('click', () => {
      // Navigate to the Driver Portal page in the same tab
      window.location.href = 'driverportal.html';
    });
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeModal);
  }

  if (rideCancelBtn) {
    rideCancelBtn.addEventListener('click', closeRideRequestModal);
  }

  if (rideRequestForm) {
    rideRequestForm.addEventListener('submit', handleRideRequestSubmit);
  }

  // Close modal when clicking outside the panel
  const modal = document.getElementById('modal');
  if (modal) {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
  }

  // Close ride request modal when clicking outside the panel
  const rideRequestModal = document.getElementById('rideRequestModal');
  if (rideRequestModal) {
    rideRequestModal.addEventListener('click', (event) => {
      if (event.target === rideRequestModal) {
        closeRideRequestModal();
      }
    });
  }

  // "Use my location" button for pickup
  const useLocationBtn = document.getElementById('useLocationBtn');
  if (useLocationBtn) {
    useLocationBtn.addEventListener('click', () => {
      // Use browser geolocation API
      if (!navigator.geolocation) {
        openModal('Location not supported', 'Your browser does not support geolocation.');
        return;
      }
      useLocationBtn.disabled = true;
      useLocationBtn.textContent = 'Getting location…';
      navigator.geolocation.getCurrentPosition(async (pos) => {
        const { latitude, longitude } = pos.coords;
        // store coords in hidden inputs
        const pickupInput = document.getElementById('pickup');
        if (pickupInput) {
          pickupInput.value = 'Current location';
        }
        document.getElementById('pickupLat').value = latitude;
        document.getElementById('pickupLon').value = longitude;

        // Optionally reverse-geocode to fill pickup text if Mapbox token is present
        if (MAPBOX_ACCESS_TOKEN) {
          try {
            const r = await fetch(`https://api.mapbox.com/geocoding/v5/mapbox.places/${longitude},${latitude}.json?access_token=${MAPBOX_ACCESS_TOKEN}&limit=1`);
            if (r.ok) {
              const data = await r.json();
              if (data && data.features && data.features.length) {
                pickupInput.value = data.features[0].place_name || 'Current location';
              }
            }
          } catch (e) {
            console.warn('Reverse geocode failed', e);
          }
        }

        // Update distance/fare if destination is present
        await updateDistanceAndFare({ source: 'geolocation' });
        useLocationBtn.disabled = false;
        useLocationBtn.textContent = 'Use my location';
      }, (err) => {
        console.warn('Geolocation error', err);
        openModal('Location error', 'Could not get your location. Please allow location access or enter a pickup address.');
        useLocationBtn.disabled = false;
        useLocationBtn.textContent = 'Use my location';
      }, { enableHighAccuracy: true, timeout: 10000 });
    });
  }

  // When ride type changes, update fare immediately
  const rideType = document.getElementById('rideType');
  if (rideType) {
    rideType.addEventListener('change', () => {
      updateDistanceAndFare({ source: 'rideType' });
    });
  }

  // Destination input: when user stops typing, try to geocode + update
  const dropoffInput = document.getElementById('dropoff');
  if (dropoffInput) {
    const onDropoffChange = debounce(async () => {
      const text = dropoffInput.value.trim();
      if (!text) {
        // clear dropoff coords
        if (document.getElementById('dropoffLat')) document.getElementById('dropoffLat').value = '';
        if (document.getElementById('dropoffLon')) document.getElementById('dropoffLon').value = '';
        await updateDistanceAndFare();
        return;
      }

      // If token present, geocode and update coords; otherwise leave text and attempt fallback
      if (MAPBOX_ACCESS_TOKEN) {
        const geo = await geocodeAddress(text);
        if (geo) {
          if (document.getElementById('dropoffLat')) document.getElementById('dropoffLat').value = geo.lat;
          if (document.getElementById('dropoffLon')) document.getElementById('dropoffLon').value = geo.lon;
        }
      }
      await updateDistanceAndFare();
    }, 800);

    dropoffInput.addEventListener('input', onDropoffChange);
    // also update on blur in case user pastes full address and doesn't trigger debounce
    dropoffInput.addEventListener('blur', onDropoffChange);
  }
}

// Keyboard support for modals
function initializeKeyboardHandlers() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
      closeRideRequestModal();
    }
  });
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  setCurrentYear();
  initializeButtonHandlers();
  initializeKeyboardHandlers();

  // If there are pre-filled values (e.g., from server), try to compute distance/fare once
  // Delay slightly to allow any server-side injected values to be populated.
  setTimeout(() => updateDistanceAndFare({ source: 'init' }), 500);
});

// Log app initialization for debugging
console.log('Rydo app initialized (distance & fare enhancements)');
