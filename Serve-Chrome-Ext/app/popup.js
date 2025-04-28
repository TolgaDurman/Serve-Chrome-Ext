document.addEventListener('DOMContentLoaded', function() {
    const openPlayerButton = document.getElementById('open-player');
    
    // Check if the extension has the necessary permissions
    // chrome.permissions.contains({
    //     permissions: ['fileSystem']
    // }, function(hasPermission) {
    //     if (!hasPermission) {
    //         openPlayerButton.textContent = 'Grant Permissions';
    //         openPlayerButton.classList.add('warning');
    //     }
    // });
    
    openPlayerButton.addEventListener('click', function() {
        // Show loading spinner
        openPlayerButton.innerHTML = '<span class="loading"></span> Opening...';
        openPlayerButton.disabled = true;
        chrome.tabs.create({ url: 'app/player.html' });
    });
});
