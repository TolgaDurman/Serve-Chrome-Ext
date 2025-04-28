document.addEventListener('DOMContentLoaded', function() {
    const openPlayerButton = document.getElementById('open-player');
    
    openPlayerButton.addEventListener('click', function() {
        chrome.tabs.create({ url: 'app/player.html' });
    });
});
