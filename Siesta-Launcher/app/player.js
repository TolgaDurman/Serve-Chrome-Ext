import { injectBmcButton } from "./bmcButton.js";

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

    // Clear previous file structure if any
    const existingStructure = document.querySelector(
      ".folder-structure-container"
    );
    if (existingStructure) {
      existingStructure.remove();
    }

    // Create and display file structure
    const structureContainer = document.createElement("div");
    structureContainer.className = "folder-structure-container";
    structureContainer.style.margin = "20px 0";
    structureContainer.style.padding = "15px";
    structureContainer.style.border = "1px solid #ccc";
    structureContainer.style.borderRadius = "8px";
    structureContainer.style.maxHeight = "300px";
    structureContainer.style.overflow = "auto";

    displayFileStructure(files, structureContainer);

    // Insert the structure before the play button
    const playButton = document.getElementById("play-button");
    playButton.parentNode.insertBefore(structureContainer, playButton);

    // Show the Play button
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
  chrome.runtime.sendMessage({ action: "clearDB" }, response => {
    if (response.success) {
        console.log("Database cleared successfully");
    } else {
        console.error("Failed to clear database:", response.error);
    }
});
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
});

// Store file in IndexedDB through background script
function storeFile(fileName, content) {
    return new Promise((resolve, reject) => {
        const attemptStore = () => {
            chrome.runtime.sendMessage(
                { action: "storeFile", fileName, content },
                response => {
                    if (response.success) {
                        resolve();
                    } else if (response.error && response.error.includes('not initialized')) {
                        // If database not initialized, wait and retry
                        setTimeout(attemptStore, 100);
                    } else {
                        reject(new Error(response.error));
                    }
                }
            );
        };
        attemptStore();
    });
}

// Get file from IndexedDB through background script
function getFile(fileName) {
    return new Promise((resolve, reject) => {
        const attemptGet = () => {
            chrome.runtime.sendMessage(
                { action: "getFile", filePath: fileName },
                response => {
                    if (response.success) {
                        resolve(response.content);
                    } else if (response.error && response.error.includes('not initialized')) {
                        // If database not initialized, wait and retry
                        setTimeout(attemptGet, 100);
                    } else {
                        reject(new Error(response.error));
                    }
                }
            );
        };
        attemptGet();
    });
}
