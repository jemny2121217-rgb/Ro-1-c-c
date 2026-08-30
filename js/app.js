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

// Modal management
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

// Button event listeners
function initializeButtonHandlers() {
  const requestRideBtn = document.getElementById('requestRide');
  const driverBtn = document.getElementById('driverBtn');
  const modalCloseBtn = document.getElementById('modalClose');

  if (requestRideBtn) {
    requestRideBtn.addEventListener('click', () => {
      openModal('Request a Ride', 'Feature coming in the next step.');
    });
  }

  if (driverBtn) {
    driverBtn.addEventListener('click', () => {
      openModal('Driver Portal', 'Feature coming in the next step.');
    });
  }

  if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', closeModal);
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
}

// Keyboard support for modal
function initializeKeyboardHandlers() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModal();
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
