import { injectBmcButton } from "./bmcButton.js";

// Constants
const DB_NAME = "webglFilesDB";
const STORE_NAME = "files";

// Database Management Module
const DatabaseManager = {
  db: null,

  async init() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
    });
  },

  async storeFile(fileName, content) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(content, fileName);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  },

  async getFile(fileName) {
    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(fileName);

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },
  async closeDB() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  },
  async closeAllDBs() {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      const req = indexedDB.open(db.name);
      req.onsuccess = () => {
        const db = req.result;
        db.close();
      };
    }
  },
  async deleteAllDBs() {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      const req = indexedDB.deleteDatabase(db.name);
      req.onsuccess = () => {
        console.log(`Successfully deleted database: ${db.name}`);
      };
      req.onerror = () => {
        console.error(`Error deleting database: ${db.name}`);
      };
    }
  },
  async clearCacheStorage() {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch (error) {
      console.error("Error clearing cache storage:", error);
    }
  },

  async clearLocalStorage() {
    try {
      await chrome.storage.local.clear();
    } catch (error) {
      console.error("Error clearing local storage:", error);
    }
  },
  async clearSessionStorage() {
    try {
      // await chrome.storage.session.clear();
      //insted of clearing the session storage, we will delete the fileList
      sessionStorage.removeItem("fileList");
    } catch (error) {
      console.error("Error clearing session storage:", error);
    }
  },
};

// UI Management Module
const UIManager = {
  showStatus(message, isError = false) {
    const status = document.getElementById("status");
    const button = document.getElementById("select-folder");

    if (message === "loading") {
      button.innerHTML = '<div class="loading"></div> Loading...';
      button.disabled = true;
      status.style.display = "none";
    } else {
      button.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24">
          <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
        </svg>
        Upload WebGL Files
      `;
      button.disabled = false;

      if (message) {
        status.textContent = message;
        status.style.display = "block";
        status.className = "status " + (isError ? "error" : "success");
      } else {
        status.style.display = "none";
      }
    }
  },

  displayFileStructure(files, parentElement) {
    const container = document.createElement("div");
    container.className = "folder-structure";

    const sortedFiles = [...files].sort((a, b) =>
      this.getRelativePath(a.webkitRelativePath).localeCompare(
        this.getRelativePath(b.webkitRelativePath)
      )
    );

    sortedFiles.forEach((file) => {
      const item = document.createElement("div");
      item.className = "folder-item";
      item.innerHTML = `
        <svg class="icon" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
          <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"/>
        </svg>
        ${this.getRelativePath(file.webkitRelativePath)}
      `;
      container.appendChild(item);
    });

    parentElement.appendChild(container);
  },

  getRelativePath(fullPath) {
    const parts = fullPath.split("/");
    return parts.length > 1 ? parts.slice(1).join("/") : fullPath;
  },

  async getStorageUsage() {
    // Try StorageManager API first
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        return estimate.usage || 0;
      } catch (e) {
        console.warn("StorageManager API not available:", e);
      }
    }

    // Fallback: sum up local/session storage and IndexedDB
    let total = 0;

    // Local Storage
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      total += (localStorage.getItem(key) || "").length * 2;
    }

    // Session Storage
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      total += (sessionStorage.getItem(key) || "").length * 2;
    }

    // IndexedDB (estimate)
    if (window.indexedDB && indexedDB.databases) {
      try {
        const dbs = await indexedDB.databases();
        for (const dbInfo of dbs) {
          const req = indexedDB.open(dbInfo.name);
          await new Promise((resolve) => {
            req.onsuccess = () => {
              const db = req.result;
              let size = 0;
              for (const storeName of db.objectStoreNames) {
                const tx = db.transaction(storeName, "readonly");
                const store = tx.objectStore(storeName);
                const countReq = store.getAll();
                countReq.onsuccess = () => {
                  for (const item of countReq.result) {
                    if (typeof item === "string") size += item.length * 2;
                    else if (item instanceof ArrayBuffer)
                      size += item.byteLength;
                    else if (typeof item === "object")
                      size += JSON.stringify(item).length * 2;
                  }
                  db.close();
                  resolve();
                };
                countReq.onerror = resolve;
              }
              total += size;
            };
            req.onerror = resolve;
          });
        }
      } catch (e) {
        console.warn("Error estimating IndexedDB size:", e);
      }
    }

    return total;
  },

  async updateStorageDisplay() {
    const usage = await this.getStorageUsage();
    const storageInfo = document.getElementById("storage-info");
    if (storageInfo) {
      storageInfo.textContent = `Storage used: ${this.formatBytes(usage)}`;
    }
  },

  formatBytes(bytes) {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  },
};

// File Management Module
const FileManager = {
  getMimeType(fileName) {
    const extension = fileName.split(".").pop().toLowerCase();
    const mimeTypes = {
      html: "text/html",
      js: "application/javascript",
      css: "text/css",
      json: "application/json",
      wasm: "application/wasm",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      gif: "image/gif",
      svg: "image/svg+xml",
      ico: "image/x-icon",
      ttf: "font/ttf",
      otf: "font/otf",
      woff: "font/woff",
      woff2: "font/woff2",
    };
    return mimeTypes[extension] || "application/octet-stream";
  },

  isTextFile(fileName) {
    const textExtensions = [
      "html",
      "js",
      "css",
      "json",
      "txt",
      "xml",
      "svg",
      "csv",
      "md",
    ];
    const ext = fileName.split(".").pop().toLowerCase();
    return textExtensions.includes(ext);
  },

  async readFile(file, asText) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader[asText ? "readAsText" : "readAsDataURL"](file);
    });
  },
};

// Main Application Module
const App = {
  init() {
    // Create and set up file input
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.webkitdirectory = true;
    fileInput.style.display = "none";
    document.body.appendChild(fileInput);

    // Set up event listeners
    document
      .getElementById("select-folder")
      .addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => this.handleFileUpload(e));
    document
      .getElementById("play-button")
      .addEventListener("click", () => this.launchGame());
    document
      .getElementById("clear-storage")
      .addEventListener("click", () => this.clearAllStorage());

    // Initialize storage display
    UIManager.updateStorageDisplay();
  },

  async handleFileUpload(event) {
    const files = Array.from(event.target.files);
    if (!files.length) {
      UIManager.showStatus("No files selected.", true);
      return;
    }

    const hasIndexHtml = files.some((file) =>
      UIManager.getRelativePath(file.webkitRelativePath)
        .toLowerCase()
        .endsWith("index.html")
    );

    if (!hasIndexHtml) {
      UIManager.showStatus(
        "No index.html found in the selected files. Please include all necessary WebGL build files.",
        true
      );
      return;
    }

    try {
      UIManager.showStatus("loading");
      await DatabaseManager.init();

      for (const file of files) {
        const relativePath = UIManager.getRelativePath(file.webkitRelativePath);
        const content = await FileManager.readFile(
          file,
          FileManager.isTextFile(file.name)
        );
        await DatabaseManager.storeFile(relativePath, content);
      }

      sessionStorage.setItem(
        "fileList",
        JSON.stringify(
          files.map((f) => UIManager.getRelativePath(f.webkitRelativePath))
        )
      );

      UIManager.showStatus(
        "Files uploaded successfully! Click Play to launch the game."
      );
      await this.updateUI(files);
    } catch (err) {
      console.error("Error:", err);
      UIManager.showStatus(
        err.message || "An error occurred while processing the files.",
        true
      );
    }
  },

  async updateUI(files) {
    await UIManager.updateStorageDisplay();
    let structureContainer = document.querySelector(
      ".folder-structure-container"
    );

    if (!structureContainer) {
      structureContainer = document.createElement("div");
      structureContainer.className = "folder-structure-container";
      structureContainer.style.margin = "20px 0";
      structureContainer.style.padding = "15px";
      structureContainer.style.border = "1px solid #ccc";
      structureContainer.style.borderRadius = "8px";
      structureContainer.style.maxHeight = "300px";
      structureContainer.style.overflow = "auto";

      const playButton = document.getElementById("play-button");
      playButton.parentNode.insertBefore(structureContainer, playButton);
    }

    structureContainer.innerHTML = "";
    UIManager.displayFileStructure(files, structureContainer);
    structureContainer.style.display = "block";

    const playButton = document.getElementById("play-button");
    playButton.style.display = "block";
  },

  async launchGame() {
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "launchUnity" }, resolve);
      });

      if (response && response.success) {
        UIManager.showStatus("Game launched successfully!");
      } else {
        UIManager.showStatus("Failed to launch game. Please try again.", true);
      }
    } catch (error) {
      console.error("Error launching game:", error);
      UIManager.showStatus("Error launching game. Please try again.", true);
    }
  },

  async clearAllStorage() {
    try {
      // Send message to background to clear all caches
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "clearCache" }, resolve);
        DatabaseManager.closeDB();
        DatabaseManager.closeAllDBs();
        DatabaseManager.clearCacheStorage();
        DatabaseManager.clearLocalStorage();
        DatabaseManager.clearSessionStorage();
        DatabaseManager.deleteAllDBs();
      });

      if (response && response.success) {
        await UIManager.updateStorageDisplay();
        UIManager.showStatus("All storage cleared successfully.");
        window.location.reload();
      } else {
        UIManager.showStatus("Error clearing storage.", true);
      }
    } catch (error) {
      console.error("Error clearing storage:", error);
      UIManager.showStatus("Error clearing storage.", true);
    }
  },
};

// Initialize the application
document.addEventListener("DOMContentLoaded", () => {
  // Inject Buy Me a Coffee button
  const container = document.querySelector(".container") || document.body;
  injectBmcButton(container, { wrapperClass: "bmc-topright" });

  // Initialize the app
  App.init();
});
