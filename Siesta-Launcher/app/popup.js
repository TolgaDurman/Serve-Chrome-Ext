import { injectBmcButton } from './bmcButton.js';

document.addEventListener('DOMContentLoaded', function() {
    const openPlayerButton = document.getElementById('open-player');
    const container = document.querySelector('.container');
    
    openPlayerButton.addEventListener('click', function() {
        // Show loading spinner
        openPlayerButton.innerHTML = '<span class="loading"></span> Opening...';
        openPlayerButton.disabled = true;
        chrome.tabs.create({ url: 'app/player.html' });
    });

    // Inject Buy Me a Coffee button
    injectBmcButton(container);
});
