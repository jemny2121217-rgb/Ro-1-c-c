/* Driver portal logic (final)
 - Uses runtime Supabase config (window.__SUPABASE_URL / window.__SUPABASE_ANON_KEY)
 - Flow: New Ride -> Accept -> Track Passenger -> Arriving -> Start Ride -> Complete Ride -> Earnings
 - Driver-only: Accept button (no Reject), no Cancel. Only passenger can cancel.
 - Conditional accept: only accepts when ride status still 'requested'.
 - Uses only existing DB columns: reads whatever columns are present on the ride row.
 - Does NOT write timestamp columns that aren't confirmed to exist. Only updates status and driver_id.
*/

(function () {
  // Utilities
  const byId = (id) => document.getElementById(id);
  const txt = (v) => (v == null ? '' : String(v));
  function safeNum(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }

  // State
  let SUPABASE_URL = window.__SUPABASE_URL || '';
  let SUPABASE_KEY = window.__SUPABASE_ANON_KEY || '';
  let DRIVER_ID = window.__DRIVER_ID ? Number(window.__DRIVER_ID) : null;
  let DRIVER_VEHICLE = 'car';
  let pollingEnabled = false;
  let pollHandle = null;
  let activeRide = null;

  // DOM refs
  const setupPanel = byId('setupPanel');
  const pendingPanel = byId('pendingPanel');
  const activePanel = byId('activePanel');
  const historyPanel = byId('historyPanel');
  const rideList = byId('rideList');
  const historyList = byId('historyList');
  const totalEarningsEl = byId('totalEarnings');
  const currentVehicleLabel = byId('currentVehicleLabel');

  // Small REST client for PostgREST (Supabase REST)
  function buildUrl(table, params = {}) {
    let url = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}`;
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v === undefined || v === null || v === '') return;
      // Allow passing preformatted operator values (e.g., 'eq.requested' or 'id=eq.1' style)
      qs.append(k, v);
    });
    const s = qs.toString();
    return s ? `${url}?${s}` : url;
  }

  async function restGet(table, params = {}) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase runtime config not set (window.__SUPABASE_URL / window.__SUPABASE_ANON_KEY).');
    const url = buildUrl(table, params);
    const r = await fetch(url, {
      method: 'GET',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        Accept: 'application/json'
      }
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`[${r.status}] ${t}`);
    }
    return r.json();
  }

  // Conditional update: patch with arbitrary query string params (e.g., id=eq.3&status=eq.requested)
  async function restPatchWithQuery(table, queryParams = {}, updates = {}) {
    if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Supabase runtime config not set.');
    const url = buildUrl(table, queryParams);
    const r = await fetch(url, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify(updates)
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error(`[${r.status}] ${t}`);
    }
    return r.json();
  }

  // Check whether the driver already has an active ride
  // Returns true if driver has any ride with status in (accepted, arriving, in_progress)
  async function isDriverBusy() {
    if (!DRIVER_ID) return false;
    try {
      // PostgREST 'in' operator: status=in.(accepted,arriving,in_progress)
      const rows = await restGet('rides', { driver_id: `eq.${DRIVER_ID}`, status: 'in.(accepted,arriving,in_progress)' });
      return Array.isArray(rows) && rows.length > 0;
    } catch (err) {
      // On error, be conservative: treat as not busy so the UI remains usable, but log the error
      console.warn('isDriverBusy check failed:', err);
      return false;
    }
  }

  // Helper: detect coordinate pairs present on a ride object
  function detectCoordinates(ride, prefixCandidates = ['pickup', 'dropoff']) {
    // Returns an object: { pickup: {lat, lon} | null, dropoff: {...} | null }
    const out = {};
    const keys = Object.keys(ride || {});
    prefixCandidates.forEach((pref) => {
      // find keys that include pref and lat/longitude words
      const latKey = keys.find(k => k.toLowerCase().includes(pref.toLowerCase()) && (k.toLowerCase().includes('lat') || k.toLowerCase().includes('latitude')));
      const lonKey = keys.find(k => k.toLowerCase().includes(pref.toLowerCase()) && (k.toLowerCase().includes('lon') || k.toLowerCase().includes('longitude')));
      if (latKey && lonKey) {
        const lat = safeNum(ride[latKey]);
        const lon = safeNum(ride[lonKey]);
        if (lat !== null && lon !== null) {
          out[pref] = { lat, lon };
          return;
        }
      }

      // Some schemas may store GeoJSON: pref -> { type: 'Point', coordinates: [lon, lat] }
      const geoKey = keys.find(k => k.toLowerCase() === pref.toLowerCase());
      if (geoKey && ride[geoKey] && ride[geoKey].coordinates && Array.isArray(ride[geoKey].coordinates)) {
        const [lon, lat] = ride[geoKey].coordinates || [];
        const latN = safeNum(lat);
        const lonN = safeNum(lon);
        if (latN !== null && lonN !== null) {
          out[pref] = { lat: latN, lon: lonN };
          return;
        }
      }

      out[pref] = null;
    });
    return out;
  }

  // Renders pending rides list (only Accept action available)
  function renderPending(rides) {
    rideList.innerHTML = '';
    if (!rides || rides.length === 0) {
      rideList.innerHTML = '<div class="small">No pending rides for your vehicle at this time.</div>';
      return;
    }
    rides.forEach(ride => {
      const card = document.createElement('div');
      card.className = 'ride-card';
      const meta = document.createElement('div');
      meta.className = 'ride-meta';
      meta.innerHTML = `
        <div><strong>#${txt(ride.id)}</strong> <span class="small">(${txt(ride.vehicle_type)})</span></div>
        <div class="small">Pickup: ${txt(ride.pickup_location || ride.pickup || '')}</div>
        <div class="small">Dropoff: ${txt(ride.dropoff_location || ride.dropoff || '')}</div>
        <div class="small">Passengers: ${txt(ride.passengers || 1)} — Fare: Rs ${txt(ride.estimated_fare || ride.fare || '—')}</div>
        <div class="small">Status: ${txt(ride.status)}</div>
      `;

      const actions = document.createElement('div');
      actions.className = 'actions';
      const acceptBtn = document.createElement('button');
      acceptBtn.className = 'btn-accept';
      acceptBtn.textContent = '✅ Accept';
      acceptBtn.addEventListener('click', () => attemptAccept(ride.id));
      actions.appendChild(acceptBtn);

      card.appendChild(meta);
      card.appendChild(actions);
      rideList.appendChild(card);
    });

    // If this client already has an active ride, disable accept buttons
    if (activeRide) {
      rideList.querySelectorAll('.btn-accept').forEach(b => { b.disabled = true; b.classList.add('btn-disabled'); });
    }
  }

  // Fetch pending rides (status=requested, vehicle_type = DRIVER_VEHICLE)
  async function fetchPending() {
    try {
      // If driver is busy, do not show pending rides
      if (await isDriverBusy()) {
        rideList.innerHTML = '<div class="small">You are currently on an active ride — no new requests are shown while busy.</div>';
        return;
      }

      // Otherwise, show pending rides for the driver's vehicle
      const rides = await restGet('rides', { status: 'eq.requested', vehicle_type: `eq.${DRIVER_VEHICLE}` });
      renderPending(rides);
    } catch (err) {
      rideList.innerHTML = `<div class="small">Error loading rides: ${err.message}</div>`;
    }
  }

  // Attempt conditional accept: PATCH ...?id=eq.<id>&status=eq.requested with body { status: 'accepted', driver_id: DRIVER_ID }
  async function attemptAccept(rideId) {
    if (!DRIVER_ID) {
      alert('Enter your Driver ID in the setup panel first.');
      return;
    }

    // Final guard: ensure driver is not already busy before attempting accept
    if (await isDriverBusy()) {
      alert('You are already on an active ride and cannot accept new rides.');
      // Refresh pending so UI reflects current state
      await fetchPending();
      return;
    }

    try {
      // Conditional patch: only succeed if ride status is still 'requested'
      const query = { id: `eq.${rideId}`, status: 'eq.requested' };
      const updates = { status: 'accepted', driver_id: DRIVER_ID };
      const res = await restPatchWithQuery('rides', query, updates);

      if (!res || res.length === 0) {
        alert('Ride no longer available (another driver accepted it or it was changed).');
        await fetchPending();
        return;
      }
      // accepted successfully; res[0] contains updated row
      activeRide = res[0];
      showActiveRide();
      // refresh pending to remove accepted ride
      await fetchPending();
      // start polling if not already
      enablePolling(true);
    } catch (err) {
      alert('Accept failed: ' + err.message);
    }
  }

  // Show active ride: set up UI and sequential actions
  function showActiveRide() {
    if (!activeRide) return;
    setupPanel.style.display = 'none';
    pendingPanel.style.display = 'none';
    activePanel.style.display = 'block';
    historyPanel.style.display = 'block';

    byId('activeRideIdLabel').textContent = `#${txt(activeRide.id)}`;
    byId('activeStatus').textContent = txt(activeRide.status || 'accepted');
    byId('activeRideDetails').innerHTML = `
      <div>Pickup: ${txt(activeRide.pickup_location || activeRide.pickup || '')}</div>
      <div>Dropoff: ${txt(activeRide.dropoff_location || activeRide.dropoff || '')}</div>
      <div class="small">Passengers: ${txt(activeRide.passengers || 1)}</div>
      <div class="small">Fare: Rs ${txt(activeRide.estimated_fare || activeRide.fare || '—')}</div>
    `;

    // Detect coordinates actually present in the ride row
    const coords = detectCoordinates(activeRide, ['pickup', 'dropoff']);
    const pickupCoords = coords.pickup;
    const dropoffCoords = coords.dropoff;

    byId('navToPickupBtn').disabled = !pickupCoords;
    byId('navToDropoffBtn').disabled = !dropoffCoords;

    if (pickupCoords) byId('passengerLocationLabel').textContent = `${pickupCoords.lat.toFixed(5)}, ${pickupCoords.lon.toFixed(5)}`;
    else byId('passengerLocationLabel').textContent = 'Coordinates not available';

    // Buttons sequencing:
    // When just accepted -> enable Arriving button only
    setActionButtonState({ arriving: true, start: false, complete: false });
  }

  // Set the enabled/disabled state of action buttons
  function setActionButtonState({ arriving = false, start = false, complete = false } = {}) {
    byId('arrivingBtn').disabled = !arriving;
    byId('startRideBtn').disabled = !start;
    byId('completeRideBtn').disabled = !complete;
  }

  // Update ride status in DB (no timestamps written). We can attempt conditional patches if needed, but simple patch is OK for in-progress transitions
  async function updateStatusTo(newStatus, allowedCurrentStatuses = []) {
    if (!activeRide) return;
    try {
      // optional guard: only allow transition when activeRide.status is one of allowedCurrentStatuses
      if (Array.isArray(allowedCurrentStatuses) && allowedCurrentStatuses.length > 0) {
        const cur = activeRide.status || '';
        if (!allowedCurrentStatuses.includes(cur)) {
          alert(`Cannot transition to ${newStatus} because current status is '${cur}'.`);
          return;
        }
      }
      const query = { id: `eq.${activeRide.id}` };
      const updates = { status: newStatus, driver_id: DRIVER_ID };
      const res = await restPatchWithQuery('rides', query, updates);
      if (!res || res.length === 0) {
        alert('Failed to update status: server did not return an updated row.');
        return;
      }
      activeRide = res[0];
      byId('activeStatus').textContent = txt(activeRide.status);

      // Advance UI sequence:
      if (newStatus === 'arriving') {
        setActionButtonState({ arriving: false, start: true, complete: false });
      } else if (newStatus === 'in_progress') {
        setActionButtonState({ arriving: false, start: false, complete: true });
      } else if (newStatus === 'completed') {
        // Completed -> refresh history/earnings and clear active ride
        await refreshHistory();
        activeRide = null;
        activePanel.style.display = 'none';
        pendingPanel.style.display = 'block';
      }
    } catch (err) {
      alert('Status update failed: ' + err.message);
    }
  }

  // Polling: refresh pending list and active ride row periodically
  function enablePolling(enable) {
    pollingEnabled = enable;
    const btn = byId('pollToggleBtn');
    if (pollingEnabled) {
      btn.textContent = 'Disable Polling';
      if (!pollHandle) {
        pollHandle = setInterval(async () => {
          try {
            // refresh pending
            await fetchPending();
            // refresh active ride by id
            if (activeRide) {
              const rows = await restGet('rides', { id: `eq.${activeRide.id}` });
              if (rows && rows.length) {
                activeRide = Object.assign({}, activeRide, rows[0]);
                // update passenger location if available
                const pc = getRideCoord(activeRide, 'pickup');
                if (pc) byId('passengerLocationLabel').textContent = `${pc.lat.toFixed(5)}, ${pc.lon.toFixed(5)}`;
                byId('activeStatus').textContent = activeRide.status;
              }
            }
          } catch (err) {
            console.warn('Poll error', err);
          }
        }, 5000);
      }
    } else {
      btn.textContent = 'Enable Polling';
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
    }
  }

  // Navigation helpers (open Google Maps directions)
  async function navTo(coords) {
    if (!coords) {
      alert('No coordinates available for this target.');
      return;
    }
    // Try to get driver's current coords for origin
    let origin = '';
    try {
      const pos = await new Promise((res, rej) => {
        navigator.geolocation.getCurrentPosition((p) => res(p), (e) => rej(e), { timeout:5000 });
      });
      origin = `${pos.coords.latitude},${pos.coords.longitude}`;
      lastDriverCoords = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      byId('driverLocationLabel').textContent = `${origin}`;
    } catch (e) {
      origin = ''; // allow Google Maps to use device default
    }
    const destination = `${coords.lat},${coords.lon}`;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}${origin ? '&origin=' + encodeURIComponent(origin) : ''}&travelmode=driving`;
    window.open(url, '_blank');
  }

  // Refresh driver history (completed rides where driver_id == DRIVER_ID)
  async function refreshHistory() {
    if (!DRIVER_ID) return;
    try {
      const history = await restGet('rides', { driver_id: `eq.${DRIVER_ID}`, status: 'eq.completed', order: 'completed_at.desc' });
      historyList.innerHTML = '';
      let total = 0;
      if (!history || history.length === 0) {
        historyList.innerHTML = '<div class="small">No completed rides yet.</div>';
      } else {
        history.forEach(r => {
          const item = document.createElement('div');
          item.className = 'ride-card';
          item.innerHTML = `
            <div>
              <div><strong>#${r.id}</strong> <span class="small">${txt(r.completed_at || '')}</span></div>
              <div class="small">From: ${txt(r.pickup_location || r.pickup || '—')}</div>
              <div class="small">To: ${txt(r.dropoff_location || r.dropoff || '—')}</div>
              <div class="small">Fare: Rs ${txt(r.estimated_fare || r.fare || '—')}</div>
            </div>
          `;
          historyList.appendChild(item);
          total += Number(r.estimated_fare || r.fare || 0);
        });
      }
      totalEarningsEl.textContent = Math.round(total || 0);
    } catch (err) {
      historyList.innerHTML = '<div class="small">Error loading history: ' + err.message + '</div>';
    }
  }

  // Wiring UI events
  function wireUi() {
    // Start Portal - uses runtime config (window.__SUPABASE_*)
    byId('startPortalBtn').addEventListener('click', async () => {
      const urlInput = byId('supabaseUrl') ? byId('supabaseUrl').value.trim() : '';
      const keyInput = byId('supabaseKey') ? byId('supabaseKey').value.trim() : '';
      const driverIdInput = byId('driverId').value.trim();
      const vehicle = byId('driverVehicle').value;

      SUPABASE_URL = urlInput || SUPABASE_URL || window.__SUPABASE_URL || '';
      SUPABASE_KEY = keyInput || SUPABASE_KEY || window.__SUPABASE_ANON_KEY || '';
      DRIVER_ID = driverIdInput ? Number(driverIdInput) : DRIVER_ID || (window.__DRIVER_ID ? Number(window.__DRIVER_ID) : null);
      DRIVER_VEHICLE = vehicle || DRIVER_VEHICLE;

      if (!SUPABASE_URL || !SUPABASE_KEY) {
        alert('Set Supabase URL and ANON key (do NOT use service-role key).');
        return;
      }
      if (!DRIVER_ID) {
        alert('Enter your Driver ID.');
        return;
      }

      // Show panels
      setupPanel.style.display = 'none';
      pendingPanel.style.display = 'block';
      historyPanel.style.display = 'block';
      currentVehicleLabel.textContent = DRIVER_VEHICLE;

      // initial load
      await fetchPending();
      await refreshHistory();
    });

    byId('refreshBtn').addEventListener('click', fetchPending);
    byId('pollToggleBtn').addEventListener('click', () => enablePolling(!pollingEnabled));

    byId('arrivingBtn').addEventListener('click', () => updateStatusTo('arriving', ['accepted']));
    byId('startRideBtn').addEventListener('click', () => updateStatusTo('in_progress', ['arriving']));
    byId('completeRideBtn').addEventListener('click', () => updateStatusTo('completed', ['in_progress']));

    byId('navToPickupBtn').addEventListener('click', () => {
      const coords = detectCoordinates(activeRide, ['pickup']).pickup;
      navTo(coords);
    });
    byId('navToDropoffBtn').addEventListener('click', () => {
      const coords = detectCoordinates(activeRide, ['dropoff']).dropoff;
      navTo(coords);
    });
  }

  // Initialize
  wireUi();

  // Expose for debugging: do not expose keys here, only helper setters for driver id/vehicle
  window._driverPortal = {
    setSupabase(url, key) { SUPABASE_URL = url; SUPABASE_KEY = key; },
    setDriver(id) { DRIVER_ID = id; },
    setVehicle(v) { DRIVER_VEHICLE = v; }
  };

  console.log('Driver portal script loaded. Configure Supabase and your driver id to begin.');
})();
