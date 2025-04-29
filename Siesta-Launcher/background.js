// Background service worker for Unity WebGL launcher
const DB_NAME = "webglFilesDB";
const STORE_NAME = "files";
let db = null;

// Initialize IndexedDB
async function initDB() {
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

// Get file from IndexedDB
async function getFileFromDB(filePath) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([STORE_NAME], "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(filePath);

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Store for extracted scripts
const extractedScripts = {};

// Function to register an extracted script to be served later
function registerExtractedScript(filename, content) {
  extractedScripts[filename] = content;
}

// Optimized binary data conversion
function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes.buffer;
}

// Listen for fetch events to our virtual file server
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Check if this is a request for our Unity game files
  if (url.pathname.startsWith("/app/")) {
    return;
  }

  event.respondWith(handleUnityFileRequest(url));
});

// Function to handle Unity file requests
async function handleUnityFileRequest(url) {
  // Extract the file path from the URL
  let filePath = url.pathname.replace("/", "");

  // If it's the root, serve index.html
  if (filePath === "" || filePath === "/") {
    filePath = "index.html";
  }

  // Check if this is a request for an extracted script
  if (extractedScripts[filePath]) {
    return new Response(extractedScripts[filePath], {
      status: 200,
      headers: {
        "Content-Type": "application/javascript",
      },
    });
  }

  try {
    // Initialize DB if not already done
    if (!db) {
      await initDB();
    }

    // Get file content from IndexedDB
    const fileContent = await getFileFromDB(filePath);

    if (!fileContent) {
      console.warn(`File not found in IndexedDB: ${filePath}`);
      return new Response("File not found", { status: 404 });
    }

    // Get content type
    const contentType = getMimeType(filePath);
    const isText =
      contentType.startsWith("text/") ||
      contentType === "application/javascript" ||
      contentType === "application/json";

    // Convert data back to proper format
    let content;
    if (isText) {
      content = fileContent;

      // If this is HTML content, modify it to extract inline scripts
      if (contentType === "text/html") {
        content = modifyHtmlContentWithRegex(content, filePath);
      }
    } else {
      // If fileContent is a data URL, extract and decode base64
      if (typeof fileContent === "string" && fileContent.startsWith("data:")) {
        const base64 = fileContent.split(",")[1];
        content = base64ToArrayBuffer(base64);
      } else {
        // fallback: serve as text (may be a misclassified file)
        content = fileContent;
      }
    }

    // Create response with appropriate headers
    return new Response(content, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cross-Origin-Embedder-Policy": "require-corp",
        "Cross-Origin-Opener-Policy": "same-origin",
      },
    });
  } catch (error) {
    console.error("Error serving Unity file:", error);
    return new Response("Error: " + error.message, { status: 500 });
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

// Function to modify HTML content using regex instead of DOM API
function modifyHtmlContentWithRegex(htmlContent, filePath) {
  let modifiedContent = htmlContent;
  let scriptCounter = 0;
  const baseDir = filePath.includes("/")
    ? filePath.substring(0, filePath.lastIndexOf("/") + 1)
    : "";

  // Regular expression to find inline scripts (scripts without src attribute)
  const inlineScriptRegex =
    /<script(?!\s+src=)([\s\S]*?)>([\s\S]*?)<\/script>/gi;

  // Replace all inline scripts with external script references
  modifiedContent = modifiedContent.replace(
    inlineScriptRegex,
    (match, attributes, content) => {
      // Skip empty scripts
      if (!content.trim()) {
        return match;
      }

      // Generate a unique filename for this script
      const scriptFileName = `${baseDir}_extracted_script_${scriptCounter++}.js`;

      // Register the extracted script content
      registerExtractedScript(scriptFileName, content);

      // Return a script tag with src attribute instead of inline content
      return `<script${attributes} src="${chrome.runtime.getURL(
        scriptFileName
      )}"></script>`;
    }
  );

  return modifiedContent;
}

// Modified function to properly close all database connections before deletion
async function deleteAllIndexedDBs() {
  try {
    // First, get all database names
    const databases = await indexedDB.databases();
    console.log("Databases to delete:", databases);
    
    // Track open connections to close them first
    const openConnections = {};
    
    // Close any open connections first
    for (const dbInfo of databases) {
      try {
        // Open the database to get a reference to it
        const openRequest = indexedDB.open(dbInfo.name);
        
        await new Promise((resolve, reject) => {
          openRequest.onerror = (event) => {
            console.error(`Error opening database ${dbInfo.name} for closure:`, event.target.error);
            resolve(); // Continue with others even if this fails
          };
          
          openRequest.onsuccess = (event) => {
            const db = event.target.result;
            // Store reference to close later
            openConnections[dbInfo.name] = db;
            console.log(`Successfully opened connection to ${dbInfo.name} for closure`);
            resolve();
          };
          
          // Handle blocked events
          openRequest.onblocked = (event) => {
            console.warn(`Database ${dbInfo.name} blocked, may have open connections`, event);
            resolve(); // Continue with others
          };
        });
      } catch (err) {
        console.error(`Error preparing database ${dbInfo.name} for deletion:`, err);
      }
    }
    
    // Close all connections we've opened
    Object.values(openConnections).forEach(db => {
      try {
        console.log(`Closing connection to database: ${db.name}`);
        db.close();
      } catch (err) {
        console.error(`Error closing database ${db.name}:`, err);
      }
    });
    
    // Now try to delete each database
    for (const dbInfo of databases) {
      try {
        await new Promise((resolve, reject) => {
          const deleteRequest = indexedDB.deleteDatabase(dbInfo.name);
          
          deleteRequest.onsuccess = (event) => {
            console.log(`Successfully deleted database: ${dbInfo.name}`);
            resolve();
          };
          
          deleteRequest.onerror = (event) => {
            console.error(`Error deleting database: ${dbInfo.name}`, event.target.error);
            resolve(); // Continue with others even if this one fails
          };
          
          deleteRequest.onblocked = (event) => {
            console.warn(`Database ${dbInfo.name} deletion blocked, trying alternative approach`, event);
            
            // Alternative approach: try to clear all object stores instead of deleting
            try {
              const openRequest = indexedDB.open(dbInfo.name);
              openRequest.onsuccess = (evt) => {
                const db = evt.target.result;
                try {
                  // Get all object store names
                  const storeNames = Array.from(db.objectStoreNames);
                  if (storeNames.length > 0) {
                    const tx = db.transaction(storeNames, 'readwrite');
                    storeNames.forEach(storeName => {
                      try {
                        console.log(`Clearing object store: ${storeName}`);
                        tx.objectStore(storeName).clear();
                      } catch (e) {
                        console.error(`Error clearing store ${storeName}:`, e);
                      }
                    });
                    tx.oncomplete = () => {
                      console.log(`Cleared all stores in ${dbInfo.name}`);
                      db.close();
                      resolve();
                    };
                    tx.onerror = (e) => {
                      console.error(`Transaction error:`, e);
                      db.close();
                      resolve();
                    };
                  } else {
                    console.log(`No object stores in ${dbInfo.name}`);
                    db.close();
                    resolve();
                  }
                } catch (e) {
                  console.error(`Error in alternative clearing:`, e);
                  if (db) db.close();
                  resolve();
                }
              };
              openRequest.onerror = () => {
                console.error(`Could not open database in alternative approach`);
                resolve();
              };
            } catch (err) {
              console.error(`Failed alternative approach:`, err);
              resolve();
            }
          };
        });
      } catch (err) {
        console.error(`Error in database deletion process for ${dbInfo.name}:`, err);
      }
    }
    
    console.log("IndexedDB deletion process completed");
    return true;
  } catch (error) {
    console.error("Error in deleteAllIndexedDBs:", error);
    return false;
  }
}

// Update the clearDB function to be more robust - detect and close connections
async function clearDB() {
  if (!db) {
    try {
      await initDB();
    } catch (err) {
      console.error("Failed to initialize DB for clearing:", err);
      throw err;
    }
  }
  
  try {
    // First try to clear the object store
    return new Promise((resolve, reject) => {
      try {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const store = transaction.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => {
          console.log(`Successfully cleared ${STORE_NAME} store`);
          // Important: Close the database after clearing
          db.close();
          db = null;
          resolve(true);
        };
        
        request.onerror = (event) => {
          console.error(`Error clearing store:`, event.target.error);
          reject(event.target.error);
        };
      } catch (err) {
        console.error("Transaction error in clearDB:", err);
        reject(err);
      }
    });
  } catch (error) {
    console.error("Error in clearDB:", error);
    throw error;
  }
}

// Listen for messages from the popup or player pages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "launchUnity") {
    chrome.tabs.create({
      url: chrome.runtime.getURL("index.html"),
    });
    sendResponse({ success: true });
    return true;
  } else if (message.action === "clearDB") {
    clearDB()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (message.action === "clearAllStorage") {
    // First close our own DB connections
    if (db) {
      try {
        db.close();
        db = null;
      } catch(e) {
        console.warn("Error closing DB in background:", e);
      }
    }
    
    // Now try to clear everything
    Promise.all([
      deleteAllIndexedDBs(),  // This now handles closing connections
      clearCacheStorage(),
      clearLocalStorage()
    ])
    .then(results => {
      console.log("All storage clearing attempts completed:", results);
      sendResponse({ success: true });
    })
    .catch((error) => {
      console.error("Error clearing all storage:", error);
      sendResponse({ success: false, error: error.message });
    });
    return true;
  }

  return false;
});

// New function to clear Cache Storage
async function clearCacheStorage() {
  try {
    if (!self.caches) {
      console.log("Cache API not available");
      return;
    }
    
    const cacheNames = await caches.keys();
    await Promise.all(
      cacheNames.map(cacheName => caches.delete(cacheName))
    );
    
    console.log("Cache storage cleared successfully");
    return true;
  } catch (error) {
    console.error("Error clearing cache storage:", error);
    throw error;
  }
}

// New function to clear other storage types when possible
async function clearLocalStorage() {
  try {
    // Clear localStorage when available (limited in service worker context)
    if (self.localStorage) {
      localStorage.clear();
      console.log("LocalStorage cleared");
    }
    
    // Clear sessionStorage when available (limited in service worker context)
    if (self.sessionStorage) {
      sessionStorage.clear();
      console.log("SessionStorage cleared");
    }
    
    return true;
  } catch (error) {
    console.error("Error clearing local/session storage:", error);
    throw error;
  }
}

