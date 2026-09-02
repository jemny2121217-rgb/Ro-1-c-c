import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

let supabase = null;

// Fare settings constants
const DEFAULT_FARES = {
  Bike: { base: 25, perKm: 14, minimum: 25 },
  Car: { base: 60, perKm: 25, minimum: 60 },
  'Tuk Tuk': { base: 45, perKm: 18, minimum: 45 }
};

// ========== INITIALIZATION ==========
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  loadSupabaseConfig();
  updateYear();
});

function setupEventListeners() {
  // Sidebar navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      handleNavClick(item);
    });
  });

  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById('mobileMenuBtn');
  const sidebar = document.getElementById('sidebar');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      sidebar.style.display = sidebar.style.display === 'none' ? 'block' : 'none';
    });
  }

  // Top buttons
  document.getElementById('refreshBtn')?.addEventListener('click', refreshCurrentView);
  document.getElementById('openSettingsBtn')?.addEventListener('click', () => {
    handleNavClick(document.querySelector('[data-view="settings"]'));
  });

  // Dashboard buttons
  document.getElementById('btnRefreshAll')?.addEventListener('click', () => {
    loadDashboard();
  });
  document.getElementById('btnExport')?.addEventListener('click', exportCSV);

  // Rides view
  document.getElementById('btnRefreshRides')?.addEventListener('click', loadRides);
  document.getElementById('btnReloadRides')?.addEventListener('click', loadRides);
  document.querySelectorAll('#rideFilters .seg').forEach(seg => {
    seg.addEventListener('click', (e) => {
      document.querySelectorAll('#rideFilters .seg').forEach(s => s.classList.remove('active'));
      e.target.classList.add('active');
      loadRides();
    });
  });

  // Earnings view
  document.querySelectorAll('#earnFilters .seg').forEach(seg => {
    seg.addEventListener('click', (e) => {
      document.querySelectorAll('#earnFilters .seg').forEach(s => s.classList.remove('active'));
      e.target.classList.add('active');
      loadEarnings();
    });
  });
  document.getElementById('btnRefreshEarnings')?.addEventListener('click', loadEarnings);

  // Fare settings
  document.getElementById('btnSaveFare')?.addEventListener('click', saveFareSettings);
  document.getElementById('btnResetFare')?.addEventListener('click', resetFareSettings);
  document.getElementById('previewVehicle')?.addEventListener('change', updateFarePreview);
  document.getElementById('previewDistance')?.addEventListener('input', updateFarePreview);

  // Supabase settings
  document.getElementById('btnConnectSB')?.addEventListener('click', connectSupabase);
  document.getElementById('btnClearSB')?.addEventListener('click', clearSupabaseConfig);
}

function handleNavClick(navItem) {
  const view = navItem.getAttribute('data-view');
  if (!view) return;

  // Update active nav item
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.remove('active');
  });
  navItem.classList.add('active');

  // Hide all views
  document.querySelectorAll('[id^="view-"]').forEach(el => {
    el.classList.add('hidden');
  });

  // Show selected view
  const viewEl = document.getElementById(`view-${view}`);
  if (viewEl) {
    viewEl.classList.remove('hidden');
  }

  // Update title
  const title = navItem.textContent.split('\n')[0].trim();
  document.getElementById('viewTitle').textContent = title;

  // Load data for the view
  switch (view) {
    case 'dashboard':
      loadDashboard();
      break;
    case 'rides':
      loadRides();
      break;
    case 'drivers':
      loadDrivers();
      break;
    case 'passengers':
      loadPassengers();
      break;
    case 'earnings':
      loadEarnings();
      break;
    case 'fare':
      loadFareSettings();
      break;
    case 'settings':
      // Settings page just shows the form, no data loading needed
      break;
  }

  // Close mobile menu
  const sidebar = document.getElementById('sidebar');
  if (window.innerWidth <= 720) {
    sidebar.style.display = 'none';
  }
}

function updateYear() {
  document.getElementById('yearAdmin').textContent = new Date().getFullYear();
}

// ========== SUPABASE CONNECTION ==========
function loadSupabaseConfig() {
  const url = localStorage.getItem('sbUrl');
  const key = localStorage.getItem('sbKey');

  if (url && key) {
    document.getElementById('sbUrl').value = url;
    document.getElementById('sbKey').value = key;
    verifySupabaseConnection(url, key);
  }
}

async function verifySupabaseConnection(url, key) {
  try {
    // Create a temporary client to test the connection
    const testClient = createClient(url, key);
    
    // Perform a harmless read query to verify actual database access
    // Query any table that's expected to exist (rides table is used throughout)
    const { error } = await testClient
      .from('rides')
      .select('count', { count: 'exact', head: true });

    if (error) {
      throw error;
    }

    // Only if query succeeds, set the global client and mark as connected
    supabase = testClient;
    document.getElementById('sbStatus').textContent = 'Connected';
    showMessage('Supabase connected and verified!', 'success');
    return true;
  } catch (error) {
    document.getElementById('sbStatus').textContent = 'Connection failed';
    showMessage('Connection failed: ' + (error.message || 'Unknown error'), 'error');
    supabase = null;
    return false;
  }
}

async function connectSupabase() {
  const url = document.getElementById('sbUrl').value.trim();
  const key = document.getElementById('sbKey').value.trim();

  if (!url || !key) {
    showMessage('Please enter both URL and key', 'error');
    return;
  }

  if (await verifySupabaseConnection(url, key)) {
    // Only save credentials if connection is verified
    localStorage.setItem('sbUrl', url);
    localStorage.setItem('sbKey', key);
  }
}

function clearSupabaseConfig() {
  localStorage.removeItem('sbUrl');
  localStorage.removeItem('sbKey');
  supabase = null;
  document.getElementById('sbUrl').value = '';
  document.getElementById('sbKey').value = '';
  document.getElementById('sbStatus').textContent = 'Not configured';
  showMessage('Supabase configuration cleared', 'success');
}

function isConnected() {
  if (!supabase) {
    showMessage('Supabase not connected. Go to settings and configure it.', 'error');
    return false;
  }
  return true;
}

// ========== FARE SETTINGS ==========
async function loadFareSettings() {
  if (!isConnected()) return;

  try {
    const { data, error } = await supabase
      .from('fare_settings')
      .select('*')
      .limit(1);

    if (error) throw error;

    let settings = data && data.length > 0 ? data[0] : null;
    
    if (!settings) {
      // Use defaults if no settings in DB
      settings = DEFAULT_FARES;
    }

    renderFareGrid(settings);
    showMessage('Fare settings loaded', 'success');
  } catch (error) {
    console.error('Error loading fare settings:', error);
    showMessage('Error loading fare settings: ' + error.message, 'error');
    renderFareGrid(DEFAULT_FARES);
  }
}

function renderFareGrid(settings) {
  const fareGrid = document.getElementById('fareGrid');
  fareGrid.innerHTML = '';

  Object.entries(settings).forEach(([vehicleType, config]) => {
    if (vehicleType === 'id' || vehicleType === 'created_at' || vehicleType === 'updated_at') return;

    const card = document.createElement('div');
    card.className = 'fare-card';
    card.innerHTML = `
      <h4 style="margin:0 0 12px 0;font-size:14px;font-weight:600">${vehicleType}</h4>
      <div class="form-row">
        <label>Base Fare (Rs)</label>
        <input type="number" class="fare-base" data-vehicle="${vehicleType}" value="${config.base || 0}" step="0.01" min="0" />
      </div>
      <div class="form-row">
        <label>Per Km Rate (Rs)</label>
        <input type="number" class="fare-perkm" data-vehicle="${vehicleType}" value="${config.perKm || 0}" step="0.01" min="0" />
      </div>
      <div class="form-row">
        <label>Minimum Fare (Rs)</label>
        <input type="number" class="fare-minimum" data-vehicle="${vehicleType}" value="${config.minimum || 0}" step="0.01" min="0" />
      </div>
    `;
    fareGrid.appendChild(card);
  });

  // Add input listeners for preview update
  document.querySelectorAll('.fare-base, .fare-perkm, .fare-minimum').forEach(input => {
    input.addEventListener('input', updateFarePreview);
  });
}

async function saveFareSettings() {
  if (!isConnected()) return;

  const settings = {};
  Object.keys(DEFAULT_FARES).forEach(vehicleType => {
    const baseInput = document.querySelector(`.fare-base[data-vehicle="${vehicleType}"]`);
    const perKmInput = document.querySelector(`.fare-perkm[data-vehicle="${vehicleType}"]`);
    const minimumInput = document.querySelector(`.fare-minimum[data-vehicle="${vehicleType}"]`);

    settings[vehicleType] = {
      base: parseFloat(baseInput?.value || 0),
      perKm: parseFloat(perKmInput?.value || 0),
      minimum: parseFloat(minimumInput?.value || 0)
    };
  });

  try {
    // Try to update existing record
    const { data: existing } = await supabase
      .from('fare_settings')
      .select('id')
      .limit(1);

    if (existing && existing.length > 0) {
      const { error } = await supabase
        .from('fare_settings')
        .update(settings)
        .eq('id', existing[0].id);
      
      if (error) throw error;
    } else {
      // Insert new record
      const { error } = await supabase
        .from('fare_settings')
        .insert([settings]);
      
      if (error) throw error;
    }

    showMessage('Fare settings saved successfully', 'success');
  } catch (error) {
    console.error('Error saving fare settings:', error);
    showMessage('Error saving fare settings: ' + error.message, 'error');
  }
}

function resetFareSettings() {
  renderFareGrid(DEFAULT_FARES);
  updateFarePreview();
  showMessage('Fare settings reset to defaults', 'success');
}

function updateFarePreview() {
  const vehicle = document.getElementById('previewVehicle').value;
  const distance = parseFloat(document.getElementById('previewDistance').value) || 0;
  const previewResult = document.getElementById('previewResult');

  const baseInput = document.querySelector(`.fare-base[data-vehicle="${vehicle}"]`);
  const perKmInput = document.querySelector(`.fare-perkm[data-vehicle="${vehicle}"]`);
  const minimumInput = document.querySelector(`.fare-minimum[data-vehicle="${vehicle}"]`);

  if (!baseInput || !perKmInput || !minimumInput) {
    previewResult.textContent = '—';
    return;
  }

  const baseFare = parseFloat(baseInput.value) || 0;
  const perKm = parseFloat(perKmInput.value) || 0;
  const minimum = parseFloat(minimumInput.value) || 0;

  const fare = calculateFare(distance, baseFare, perKm, minimum);
  previewResult.textContent = `Rs ${fare.toFixed(2)}`;
}

function calculateFare(distanceKm, baseFare, perKm, minimumFare) {
  return Math.max(minimumFare, baseFare + distanceKm * perKm);
}

// ========== DASHBOARD & RIDES ==========
async function loadDashboard() {
  if (!isConnected()) return;

  try {
    const { data: rides, error } = await supabase
      .from('rides')
      .select('*');

    if (error) throw error;

    if (!rides) {
      clearDashboard();
      return;
    }

    const total = rides.length;
    const requested = rides.filter(r => r.status === 'requested').length;
    const active = rides.filter(r => r.status === 'active').length;
    const completed = rides.filter(r => r.status === 'completed').length;
    const cancelled = rides.filter(r => r.status === 'cancelled').length;

    let totalRevenue = 0;
    let driverEarnings = 0;
    let rydoCommission = 0;

    rides.forEach(ride => {
      if (ride.fare) {
        totalRevenue += ride.fare;
        // Assuming 80% to driver, 20% to Rydo (adjust if needed)
        driverEarnings += ride.fare * 0.8;
        rydoCommission += ride.fare * 0.2;
      }
    });

    document.getElementById('cardTotalRides').textContent = total;
    document.getElementById('cardRequested').textContent = requested;
    document.getElementById('cardActive').textContent = active;
    document.getElementById('cardCompleted').textContent = completed;
    document.getElementById('cardCancelled').textContent = cancelled;
    document.getElementById('cardRevenue').textContent = `Rs ${totalRevenue.toFixed(2)}`;
    document.getElementById('cardDriverEarnings').textContent = `Rs ${driverEarnings.toFixed(2)}`;
    document.getElementById('cardCommission').textContent = `Rs ${rydoCommission.toFixed(2)}`;

    // Update badges
    document.getElementById('ridesBadge').textContent = total;
    document.getElementById('driversBadge').textContent = '—';
    document.getElementById('passengersBadge').textContent = '—';

    showMessage('Dashboard loaded', 'success');
  } catch (error) {
    console.error('Error loading dashboard:', error);
    showMessage('Error loading dashboard: ' + error.message, 'error');
    clearDashboard();
  }
}

function clearDashboard() {
  document.getElementById('cardTotalRides').textContent = '—';
  document.getElementById('cardRequested').textContent = '—';
  document.getElementById('cardActive').textContent = '—';
  document.getElementById('cardCompleted').textContent = '—';
  document.getElementById('cardCancelled').textContent = '—';
  document.getElementById('cardRevenue').textContent = 'Rs —';
  document.getElementById('cardDriverEarnings').textContent = 'Rs —';
  document.getElementById('cardCommission').textContent = 'Rs —';
}

async function loadRides() {
  if (!isConnected()) return;

  try {
    const { data: rides, error } = await supabase
      .from('rides')
      .select('*');

    if (error) throw error;

    const activeStatus = document.querySelector('#rideFilters .seg.active')?.getAttribute('data-status') || 'all';
    
    let filteredRides = rides || [];
    if (activeStatus !== 'all') {
      filteredRides = filteredRides.filter(r => {
        if (activeStatus === 'active') {
          return r.status === 'active' || r.status === 'accepted';
        }
        return r.status === activeStatus;
      });
    }

    const tbody = document.getElementById('ridesTbody');
    tbody.innerHTML = '';

    if (filteredRides.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10">No rides found</td></tr>';
      showMessage('Rides loaded', 'success');
      return;
    }

    filteredRides.forEach(ride => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${ride.id ? ride.id.substring(0, 8) : '—'}</td>
        <td>${ride.passenger_name || '—'}</td>
        <td>${ride.driver_name || '—'}</td>
        <td>${ride.vehicle_type || '—'}</td>
        <td>${ride.pickup_location || '—'}</td>
        <td>${ride.destination || '—'}</td>
        <td>${ride.distance_km ? ride.distance_km.toFixed(2) + ' km' : '—'}</td>
        <td>Rs ${ride.fare ? ride.fare.toFixed(2) : '—'}</td>
        <td>${ride.status || '—'}</td>
        <td>${ride.created_at ? new Date(ride.created_at).toLocaleString() : '—'}</td>
      `;
      tbody.appendChild(row);
    });

    showMessage('Rides loaded', 'success');
  } catch (error) {
    console.error('Error loading rides:', error);
    showMessage('Error loading rides: ' + error.message, 'error');
    const tbody = document.getElementById('ridesTbody');
    tbody.innerHTML = '<tr><td colspan="10">Error loading rides</td></tr>';
  }
}

async function loadDrivers() {
  if (!isConnected()) return;

  try {
    const { data: drivers, error } = await supabase
      .from('drivers')
      .select('*');

    if (error) throw error;

    const tbody = document.getElementById('driversTbody');
    tbody.innerHTML = '';

    if (!drivers || drivers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No drivers found</td></tr>';
      return;
    }

    drivers.forEach(driver => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${driver.name || '—'}</td>
        <td>${driver.vehicle_type || '—'}</td>
        <td>${driver.status || '—'}</td>
        <td>${driver.total_rides || 0}</td>
        <td>${driver.completed_rides || 0}</td>
        <td>Rs ${driver.total_earnings ? driver.total_earnings.toFixed(2) : '0.00'}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading drivers:', error);
    const tbody = document.getElementById('driversTbody');
    tbody.innerHTML = '<tr><td colspan="6">Error loading drivers</td></tr>';
  }
}

async function loadPassengers() {
  if (!isConnected()) return;

  try {
    const { data: passengers, error } = await supabase
      .from('passengers')
      .select('*');

    if (error) throw error;

    const tbody = document.getElementById('passengersTbody');
    tbody.innerHTML = '';

    if (!passengers || passengers.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4">No passengers found</td></tr>';
      return;
    }

    passengers.forEach(passenger => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${passenger.name || '—'}</td>
        <td>${passenger.phone || '—'}</td>
        <td>${passenger.total_rides || 0}</td>
        <td>${passenger.completed_rides || 0}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (error) {
    console.error('Error loading passengers:', error);
    const tbody = document.getElementById('passengersTbody');
    tbody.innerHTML = '<tr><td colspan="4">Error loading passengers</td></tr>';
  }
}

async function loadEarnings() {
  if (!isConnected()) return;

  try {
    const { data: rides, error } = await supabase
      .from('rides')
      .select('*')
      .eq('status', 'completed');

    if (error) throw error;

    const activeRange = document.querySelector('#earnFilters .seg.active')?.getAttribute('data-range') || 'today';
    
    let filteredRides = rides || [];
    const now = new Date();

    if (activeRange !== 'all') {
      filteredRides = filteredRides.filter(ride => {
        if (!ride.created_at) return false;
        const rideDate = new Date(ride.created_at);
        
        switch (activeRange) {
          case 'today':
            return rideDate.toDateString() === now.toDateString();
          case 'week':
            const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            return rideDate >= weekAgo;
          case 'month':
            const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            return rideDate >= monthAgo;
          default:
            return true;
        }
      });
    }

    let totalFare = 0;
    let driverEarnings = 0;
    let rydoCommission = 0;

    filteredRides.forEach(ride => {
      if (ride.fare) {
        totalFare += ride.fare;
        driverEarnings += ride.fare * 0.8;
        rydoCommission += ride.fare * 0.2;
      }
    });

    document.getElementById('earnTotalFare').textContent = `Rs ${totalFare.toFixed(2)}`;
    document.getElementById('earnDriver').textContent = `Rs ${driverEarnings.toFixed(2)}`;
    document.getElementById('earnCommission').textContent = `Rs ${rydoCommission.toFixed(2)}`;
    document.getElementById('earnCompletedCount').textContent = filteredRides.length;

    showMessage('Earnings loaded', 'success');
  } catch (error) {
    console.error('Error loading earnings:', error);
    showMessage('Error loading earnings: ' + error.message, 'error');
  }
}

// ========== UTILITY FUNCTIONS ==========
function refreshCurrentView() {
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav) {
    handleNavClick(activeNav);
  }
}

function exportCSV() {
  if (!isConnected()) return;

  showMessage('Export feature coming soon', 'success');
}

function showMessage(message, type = 'info') {
  // Clear all existing messages after 3 seconds
  setTimeout(() => {
    clearMessages();
  }, 3000);

  // Show the message (you could create a toast/notification here)
  console.log(`[${type.toUpperCase()}] ${message}`);
}

function clearMessages() {
  // Messages auto-clear after 3 seconds
}

// Hide helper class
document.addEventListener('DOMContentLoaded', () => {
  const style = document.createElement('style');
  style.textContent = '.hidden { display: none !important; }';
  document.head.appendChild(style);
});
