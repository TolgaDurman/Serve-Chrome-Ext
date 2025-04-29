// Tab Management Module
const TabManager = {
  openPlayer() {
    return chrome.tabs.create({ url: "app/player.html" });
  },
};

// Main Application Module
const App = {
  init() {
    //search tabs with url of "app/player.html" if found, navigate to it
    TabManager.openPlayer();
  },
};

// Initialize the application
document.addEventListener("DOMContentLoaded", () => App.init());
