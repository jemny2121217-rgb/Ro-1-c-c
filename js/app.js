/**
 * Rydo — Move your way.
 * Main application script
 */

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

// Handle ride request form submission
function handleRideRequestSubmit(event) {
  event.preventDefault();
  
  const pickup = document.getElementById('pickup').value;
  const dropoff = document.getElementById('dropoff').value;
  const rideType = document.getElementById('rideType').value;
  const passengers = document.getElementById('passengers').value;
  const notes = document.getElementById('notes').value;

  // Show confirmation modal
  const message = `Ride requested!\nPickup: ${pickup}\nDropoff: ${dropoff}\nType: ${rideType}\nPassengers: ${passengers}${notes ? '\nNotes: ' + notes : ''}`;
  openModal('Ride Requested', message);
  
  // Reset form and close ride modal
  const form = document.getElementById('rideRequestForm');
  if (form) {
    form.reset();
  }
  closeRideRequestModal();
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
      openModal('Driver Portal', 'Feature coming in the next step.');
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
});

// Log app initialization for debugging
console.log('Rydo app initialized');
