// Initialize event listeners when DOM is loaded
document.addEventListener('DOMContentLoaded', function () {
    initializeEventListeners();
    loadSavedTheme();
});

function initializeEventListeners() {
    // Navigation links
    const navLinks = document.querySelectorAll('.nav-link');
    navLinks.forEach(link => {
        link.addEventListener('click', function (e) {
            e.preventDefault();
            const page = this.getAttribute('data-page');
            showPage(page, this);
        });
    });

    // Menu toggle
    const menuToggle = document.getElementById('menuToggle');
    if (menuToggle) {
        menuToggle.addEventListener('click', toggleMenu);
    }

    // Theme toggle
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', toggleTheme);
    }

    // Form submission
    const recruitmentForm = document.getElementById('recruitmentForm');
    if (recruitmentForm) {
        recruitmentForm.addEventListener('submit', submitApplication);
    }

    // Close mobile menu when clicking outside
    document.addEventListener('click', function (event) {
        const nav = document.querySelector('.nav-container');
        const menu = document.getElementById('navLinks');

        if (nav && menu && !nav.contains(event.target)) {
            menu.classList.remove('active');
        }
    });
}

// Theme toggle functionality
function toggleTheme() {
    const body = document.body;
    const themeIcon = document.getElementById('themeIcon');

    if (body.getAttribute('data-theme') === 'dark') {
        body.removeAttribute('data-theme');
        themeIcon.textContent = '🌙';
        localStorage.setItem('theme', 'light');
    } else {
        body.setAttribute('data-theme', 'dark');
        themeIcon.textContent = '☀️';
        localStorage.setItem('theme', 'dark');
    }
}

// Load saved theme on page load
function loadSavedTheme() {
    const savedTheme = localStorage.getItem('theme');
    const themeIcon = document.getElementById('themeIcon');

    if (savedTheme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
        if (themeIcon) themeIcon.textContent = '☀️';
    } else {
        if (themeIcon) themeIcon.textContent = '🌙';
    }
}

// Page navigation
function showPage(pageId, clickedLink) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(page => {
        page.classList.remove('active');
    });

    // Show selected page
    const targetPage = document.getElementById(pageId);
    if (targetPage) {
        targetPage.classList.add('active');
    }

    // Update navigation
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    if (clickedLink) {
        clickedLink.classList.add('active');
    }

    // Close mobile menu
    const navLinks = document.getElementById('navLinks');
    if (navLinks) {
        navLinks.classList.remove('active');
    }
}

// Mobile menu toggle
function toggleMenu() {
    const navLinks = document.getElementById('navLinks');
    if (navLinks) {
        navLinks.classList.toggle('active');
    }
}

// Form submission
async function submitApplication(event) {
    event.preventDefault();

    const submitButton = event.target.querySelector('button[type="submit"]');
    const originalText = submitButton.textContent;

    // Disable button and show loading state
    submitButton.disabled = true;
    submitButton.textContent = 'Submitting...';

    try {
        // Get form data
        const formData = new FormData(event.target);
        const data = Object.fromEntries(formData);

        // Send to backend
        const response = await fetch('/api/application', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data)
        });

        const result = await response.json();

        if (result.success) {
            // Show success message
            alert('✅ ' + result.message);

            // Reset form
            event.target.reset();
        } else {
            // Show validation errors
            if (result.errors && result.errors.length > 0) {
                alert('❌ Please fix the following errors:\n\n' + result.errors.join('\n'));
            } else {
                alert('❌ ' + (result.message || 'An error occurred while submitting your application.'));
            }
        }

    } catch (error) {
        console.error('Submission error:', error);

        if (error.name === 'TypeError' && error.message.includes('fetch')) {
            alert('❌ Network error. Please check your connection and try again.');
        } else {
            alert('❌ An unexpected error occurred. Please try again later.');
        }
    } finally {
        // Re-enable button
        submitButton.disabled = false;
        submitButton.textContent = originalText;
    }
}

// Close mobile menu when clicking outside
document.addEventListener('click', function (event) {
    const nav = document.querySelector('.nav-container');
    const menu = document.getElementById('navLinks');

    if (!nav.contains(event.target)) {
        menu.classList.remove('active');
    }
});
