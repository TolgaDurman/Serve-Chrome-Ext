// launcher.js - Script for launcher.html
document.addEventListener('DOMContentLoaded', function() {
    const closeButton = document.getElementById('close-button');
    const unityFrame = document.getElementById('unity-frame');
    const loading = document.getElementById('loading');
    const errorMessage = document.getElementById('error-message');
    
    // Set the iframe source to the game's index.html through our extension's URL handler
    unityFrame.src = chrome.runtime.getURL('unity-game/index.html');
    
    // Handle communication with the file system
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.response && message.filePath) {
            if (!message.success) {
                // Show error message
                errorMessage.textContent = `Error loading file: ${message.filePath} - ${message.error}`;
                errorMessage.style.display = 'block';
            }
        }
    });
    
    // Hide loading once the iframe is loaded
    unityFrame.addEventListener('load', function() {
        loading.style.display = 'none';
    });
    
    // Handle load errors
    unityFrame.addEventListener('error', function(e) {
        errorMessage.textContent = 'Failed to load Unity game. Please check the console for details.';
        errorMessage.style.display = 'block';
        console.error('Frame loading error:', e);
    });
    
    // Handle close button click
    closeButton.addEventListener('click', function() {
        window.close();
    });
});