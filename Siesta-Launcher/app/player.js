import { injectBmcButton } from "./bmcButton.js";

// IndexedDB setup
const DB_NAME = "webglFilesDB";
const STORE_NAME = "files";
let db = null;

// Initialize IndexedDB
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      db = request.result;
      resolve();
    };

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

// Store file in IndexedDB
function storeFile(fileName, content) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.put(content, fileName);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

// Get file from IndexedDB
function getFile(fileName) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(fileName);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Status message handler
function showStatus(message, isError = false) {
  const status = document.getElementById("status");
  const button = document.getElementById("select-folder");
  const playButton = document.getElementById("play-button");

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
}

// Register this tab as having file access
function registerAsFileAccessTab() {
  chrome.runtime.sendMessage({
    action: "registerFileAccessTab",
  });
}

// Check if a directory contains index.html
async function checkForIndexHtml(dirHandle, path = "") {
  for await (const entry of dirHandle.values()) {
    if (entry.kind === "file" && entry.name.toLowerCase() === "index.html") {
      return true;
    } else if (entry.kind === "directory") {
      const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
      const subResult = await checkForIndexHtml(
        subDirHandle,
        path ? `${path}/${entry.name}` : entry.name
      );
      if (subResult) return true;
    }
  }
  return false;
}

// Get MIME type based on file extension
function getMimeType(fileName) {
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
}

// Function to get relative path without root folder
function getRelativePath(fullPath) {
  const parts = fullPath.split("/");
  if (parts.length > 1) {
    return parts.slice(1).join("/");
  }
  return fullPath;
}

// Function to display file structure
function displayFileStructure(files, parentElement) {
  const container = document.createElement("div");
  container.className = "folder-structure";

  // Sort files by path for better display
  const sortedFiles = [...files].sort((a, b) =>
    getRelativePath(a.webkitRelativePath).localeCompare(
      getRelativePath(b.webkitRelativePath)
    )
  );

  sortedFiles.forEach((file) => {
    const item = document.createElement("div");
    item.className = "folder-item";
    item.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24" style="width: 16px; height: 16px;">
                <path d="M6 2c-1.1 0-1.99.9-1.99 2L4 20c0 1.1.89 2 1.99 2H18c1.1 0 2-.9 2-2V8l-6-6H6zm7 7V3.5L18.5 9H13z"/>
            </svg>
            ${getRelativePath(file.webkitRelativePath)}
        `;
    container.appendChild(item);
  });

  parentElement.appendChild(container);
}

// Helper to detect if a file is text
function isTextFile(fileName) {
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
}

// Handle file upload
async function handleFileUpload(event) {
  const files = Array.from(event.target.files);
  if (!files.length) {
    showStatus("No files selected.", true);
    return;
  }

  // Check if index.html exists
  const hasIndexHtml = files.some((file) =>
    getRelativePath(file.webkitRelativePath)
      .toLowerCase()
      .endsWith("index.html")
  );
  if (!hasIndexHtml) {
    showStatus(
      "No index.html found in the selected files. Please include all necessary WebGL build files.",
      true
    );
    return;
  }

  try {
    showStatus("loading");

    // Initialize IndexedDB
    await initDB();

    // Store files in IndexedDB with their relative paths
    for (const file of files) {
      const relativePath = getRelativePath(file.webkitRelativePath);
      let content;
      if (isTextFile(file.name)) {
        // Read as text
        content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsText(file);
        });
      } else {
        // Read as base64 data URL
        content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target.result);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });
      }
      await storeFile(relativePath, content);
    }

    // Store file list with relative paths in session storage
    sessionStorage.setItem(
      "fileList",
      JSON.stringify(files.map((f) => getRelativePath(f.webkitRelativePath)))
    );

    showStatus("Files uploaded successfully! Click Play to launch the game.");

    // Update storage display
    await updateStorageDisplay();

    // Get or create folder structure container
    let structureContainer = document.querySelector(".folder-structure-container");
    if (!structureContainer) {
      structureContainer = document.createElement("div");
      structureContainer.className = "folder-structure-container";
      structureContainer.style.margin = "20px 0";
      structureContainer.style.padding = "15px";
      structureContainer.style.border = "1px solid #ccc";
      structureContainer.style.borderRadius = "8px";
      structureContainer.style.maxHeight = "300px";
      structureContainer.style.overflow = "auto";
      
      // Insert before play button
      const playButton = document.getElementById("play-button");
      playButton.parentNode.insertBefore(structureContainer, playButton);
    }

    // Clear existing content and display new structure
    structureContainer.innerHTML = '';
    displayFileStructure(files, structureContainer);
    structureContainer.style.display = "block";

    // Show the Play button
    const playButton = document.getElementById("play-button");
    playButton.style.display = "block";
  } catch (err) {
    console.error("Error:", err);
    showStatus(
      err.message || "An error occurred while processing the files.",
      true
    );
  }
}

// Handle game launch
function launchUnity() {
  const fileList = JSON.parse(sessionStorage.getItem("fileList"));
  if (!fileList || !fileList.length) {
    showStatus("Please upload files first.", true);
    return;
  }

  chrome.runtime.sendMessage({ action: "launchUnity" }, function (response) {
    if (response && response.success) {
      showStatus("Unity WebGL game launched successfully!");
    } else {
      showStatus("Failed to launch Unity WebGL game.", true);
    }
  });
}

// Listen for file requests
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getFile") {
    getFile(message.filePath)
      .then((fileContent) => {
        if (!fileContent) {
          sendResponse({
            response: true,
            success: false,
            filePath: message.filePath,
            error: "File not found",
          });
          return;
        }

        const contentType = getMimeType(message.filePath);
        const isText =
          contentType.startsWith("text/") ||
          contentType === "application/javascript" ||
          contentType === "application/json";

        sendResponse({
          response: true,
          success: true,
          filePath: message.filePath,
          content: fileContent,
          contentType: contentType,
          isText: isText,
        });
      })
      .catch((error) => {
        sendResponse({
          response: true,
          success: false,
          filePath: message.filePath,
          error: error.message,
        });
      });
    return true;
  }
});

// Add event listeners
document.addEventListener("DOMContentLoaded", function () {
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.webkitdirectory = true;
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  document
    .getElementById("select-folder")
    .addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", handleFileUpload);
  document.getElementById("play-button").addEventListener("click", launchUnity);

  // Inject Buy Me a Coffee button in top right
  injectBmcButton(document.body, { wrapperClass: "bmc-topright" });

  updateStorageDisplay();
  document.getElementById("clear-storage").addEventListener("click", async () => {
    await clearAllStorage();
    //remove list of items and play button
    const playButton = document.getElementById("play-button");
    playButton.parentNode.removeChild(playButton);
    const structureContainer = document.querySelector(
      ".folder-structure-container"
    );
    if (structureContainer) {
      structureContainer.remove();
    }
    showStatus("All storage cleared.");
  });
});

// --- Storage Usage and Clear Logic ---
async function getStorageUsage() {
  // Try StorageManager API (best effort, not all browsers/extensions support it)
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const estimate = await navigator.storage.estimate();
      return estimate.usage || 0;
    } catch (e) {}
  }
  // Fallback: sum up local/session storage, cookies, and IndexedDB (approximate)
  let total = 0;
  // Local Storage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    total += ((localStorage.getItem(key) || '').length * 2);
  }
  // Session Storage
  for (let i = 0; i < sessionStorage.length; i++) {
    const key = sessionStorage.key(i);
    total += ((sessionStorage.getItem(key) || '').length * 2);
  }
  // Cookies
  total += (document.cookie || '').length;
  // IndexedDB (estimate: count all objects in all DBs)
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
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const countReq = store.getAll();
              countReq.onsuccess = () => {
                for (const item of countReq.result) {
                  if (typeof item === 'string') size += item.length * 2;
                  else if (item instanceof ArrayBuffer) size += item.byteLength;
                  else if (typeof item === 'object') size += JSON.stringify(item).length * 2;
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
    } catch (e) {}
  }
  // Cache Storage
  if (window.caches && caches.keys) {
    try {
      const keys = await caches.keys();
      for (const key of keys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        for (const req of requests) {
          const res = await cache.match(req);
          if (res) {
            const buf = await res.arrayBuffer();
            total += buf.byteLength;
          }
        }
      }
    } catch (e) {}
  }
  return total;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function updateStorageDisplay() {
  const el = document.getElementById('storage-used');
  if (!el) return;
  el.textContent = 'Calculating...';
  const usage = await getStorageUsage();
  el.textContent = formatBytes(usage);
}

async function clearAllStorage() {
    try {
      // First clear any client-side storage we can access directly
      localStorage.clear();
      sessionStorage.clear();
      
      // Then ask the service worker to clear all storage types
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ action: "clearAllStorage" }, response => {
          if (response && response.success) {
            console.log("All storage cleared successfully");
            // Create a small delay before reload to ensure clearing completes
            setTimeout(() => {
              window.location.reload();
            }, 500);
            resolve(true);
          } else {
            const errorMsg = response ? response.error : "Unknown error";
            console.error("Failed to clear storage:", errorMsg);
            showStatus("Error clearing storage: " + errorMsg, true);
            reject(new Error(errorMsg));
          }
        });
      });
    } catch (error) {
      console.error("Error in clearAllStorage:", error);
      showStatus("Error clearing storage: " + error.message, true);
      throw error;
    }
  }