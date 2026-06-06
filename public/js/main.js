// Shared utility functions for the Placement Management System
console.log('PMS Client-side JS loaded'); // Confirms common client script is loaded.

// Function to format currency
function formatCurrency(amount) { // Converts a number into INR currency format.
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
    }).format(amount);
}

// Function to validate email format
function validateEmail(email) { // Checks whether an email string is valid.
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/; // Basic email pattern validation.
    return re.test(email);
}
