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

// New implementation focusing on the blocked-event issue
async function deleteAllIndexedDBs() {
  try {
    if(db){
      db.close();
      db = null;
    }
    const databases = await indexedDB.databases();
    console.log("Databases to delete:", databases);
    
    if (databases.length === 0) {
      console.log("No databases to delete");
      return true;
    }
    
    // First, attempt to close any existing connections from our own code
    if (typeof db !== 'undefined' && db) {
      try {
        console.log("Closing our known DB connection");
        db.close();
        db = null;
      } catch (e) {
        console.warn("Error closing known DB:", e);
      }
    }
    
    // This part is crucial: we need to wait for "versionchange" events to complete
    // by listening to them in any context that might have the DB open
    
    // Broadcast a message to all contexts to close their connections
    try {
      // Send message to all tabs to close their DB connections
      const tabs = await chrome.tabs.query({});
      for (const tab of tabs) {
        try {
          await chrome.tabs.sendMessage(tab.id, { action: "closeDBConnections" });
          console.log("Sent close connection message to tab:", tab.id);
        } catch (e) {
          // Ignore errors for tabs that don't have content scripts
          console.log("Could not send to tab:", tab.id);
        }
      }
      
      // Also notify popup if open
      try {
        chrome.runtime.sendMessage({ action: "closeDBConnections" });
      } catch (e) {
        console.log("Could not send to popup/others");
      }
      
      // Give time for connections to close
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (e) {
      console.warn("Error broadcasting close message:", e);
    }

    // Now try to delete each database with robust error handling
    const results = await Promise.all(databases.map(async (dbInfo) => {
      return await new Promise((resolve) => {
        console.log(`Attempting to delete database: ${dbInfo.name}`);
        
        // First try: regular deletion
        const deleteRequest = indexedDB.deleteDatabase(dbInfo.name);
        
        deleteRequest.onsuccess = () => {
          console.log(`Successfully deleted database: ${dbInfo.name}`);
          resolve(true);
        };
        
        deleteRequest.onerror = (event) => {
          console.error(`Error deleting database: ${dbInfo.name}`, event.target.error);
          resolve(false);
        };
        
        deleteRequest.onblocked = async (event) => {
          console.warn(`Database ${dbInfo.name} deletion blocked, trying alternative approach`);
          
          // ALTERNATIVE APPROACH 1: Try to open and clear all stores
          try {
            const altResult = await clearAllObjectStores(dbInfo.name);
            resolve(altResult);
          } catch (e) {
            console.error("Alternative approach failed:", e);
            resolve(false);
          }
        };
      });
    }));
    
    // Check if all deletions were successful
    const allSuccessful = results.every(result => result === true);
    console.log(`IndexedDB deletion process completed. All successful: ${allSuccessful}`);
    
    return allSuccessful;
  } catch (error) {
    console.error("Error in deleteAllIndexedDBs:", error);
    return false;
  }
}

// New helper function to clear all object stores in a database
async function clearAllObjectStores(dbName) {
  return new Promise((resolve, reject) => {
    let open = indexedDB.open(dbName);
    let success = false;
    
    open.onsuccess = function(event) {
      let db = event.target.result;
      try {
        // Use the database version to ensure we control all connections
        const version = db.version;
        const storeNames = Array.from(db.objectStoreNames);
        console.log(`DB ${dbName} has stores:`, storeNames);
        
        // Close this connection
        db.close();
        
        if (storeNames.length > 0) {
          // Reopen with a higher version to kick out other connections
          let reopenRequest = indexedDB.open(dbName, version + 1);
          
          reopenRequest.onupgradeneeded = function(event) {
            let db = event.target.result;
            console.log(`Upgrade called on ${dbName}, can now clear data`);
            
            // Delete each object store
            for (let storeName of storeNames) {
              try {
                console.log(`Deleting store: ${storeName}`);
                db.deleteObjectStore(storeName);
              } catch (e) {
                console.warn(`Couldn't delete store ${storeName}:`, e);
              }
            }
            success = true;
          };
          
          reopenRequest.onsuccess = function(event) {
            let db = event.target.result;
            console.log(`Reopened ${dbName} at higher version`);
            db.close();
            
            // Now attempt deletion again
            setTimeout(() => {
              let finalDeleteRequest = indexedDB.deleteDatabase(dbName);
              finalDeleteRequest.onsuccess = () => {
                console.log(`Finally deleted ${dbName} after clearing`);
                resolve(true);
              };
              finalDeleteRequest.onerror = (e) => {
                console.error(`Still couldn't delete ${dbName}:`, e);
                resolve(success); // At least we cleared it
              };
            }, 100);
          };
          
          reopenRequest.onerror = function(event) {
            console.error(`Error reopening ${dbName}:`, event.target.error);
            // Try deleting anyway
            let finalTryRequest = indexedDB.deleteDatabase(dbName);
            finalTryRequest.onsuccess = () => resolve(true);
            finalTryRequest.onerror = () => resolve(false);
          };
        } else {
          // No stores, try delete again
          const finalRequest = indexedDB.deleteDatabase(dbName);
          finalRequest.onsuccess = () => resolve(true);
          finalRequest.onerror = () => resolve(false);
        }
      } catch (e) {
        console.error(`Error clearing object stores for ${dbName}:`, e);
        db.close();
        reject(e);
      }
    };
    
    open.onerror = function(event) {
      console.error(`Could not open database ${dbName} for clearing:`, event.target.error);
      reject(event.target.error);
    };
  });
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
  } else if (message.action === "closeDBConnections") {
    // Close any open database connections in this context
    if (typeof db !== 'undefined' && db) {
      try {
        console.log("Background script closing DB connection on request");
        db.close();
        db = null;
        sendResponse({ success: true });
      } catch (e) {
        console.warn("Error closing DB in background:", e);
        sendResponse({ success: false, error: e.message });
      }
    } else {
      sendResponse({ success: true, message: "No open connections" });
    }
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

// Add this to the service worker's global scope to catch and handle versionchange events
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'CLOSE_INDEXEDDB') {
    console.log("Service worker received close request");
    if (typeof db !== 'undefined' && db) {
      try {
        db.close();
        db = null;
      } catch (e) {
        console.warn("Error in worker closing DB:", e);
      }
    }
  }
});

