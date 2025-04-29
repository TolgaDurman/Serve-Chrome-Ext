// Background service worker for Unity WebGL launcher
const DB_NAME = 'webglFilesDB';
const STORE_NAME = 'files';
let db = null;
let dbInitialized = false;

// Initialize IndexedDB
async function initDB() {
    if (dbInitialized) return;
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            db = request.result;
            dbInitialized = true;
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

// Initialize database when service worker starts
initDB().catch(error => {
    console.error('Failed to initialize database:', error);
});

// Get file from IndexedDB
async function getFileFromDB(filePath) {
    if (!dbInitialized) {
        await initDB();
    }
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(filePath);
        
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

// Store file in IndexedDB
async function storeFileInDB(fileName, content) {
    if (!dbInitialized) {
        await initDB();
    }
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put(content, fileName);
        
        request.onsuccess = () => resolve();
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
        const isText = contentType.startsWith('text/') || 
                      contentType === 'application/javascript' || 
                      contentType === 'application/json';

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
            if (typeof fileContent === 'string' && fileContent.startsWith('data:')) {
                const base64 = fileContent.split(',')[1];
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
    const extension = fileName.split('.').pop().toLowerCase();
    const mimeTypes = {
        'html': 'text/html',
        'js': 'application/javascript',
        'css': 'text/css',
        'json': 'application/json',
        'wasm': 'application/wasm',
        'png': 'image/png',
        'jpg': 'image/jpeg',
        'jpeg': 'image/jpeg',
        'gif': 'image/gif',
        'svg': 'image/svg+xml',
        'ico': 'image/x-icon',
        'ttf': 'font/ttf',
        'otf': 'font/otf',
        'woff': 'font/woff',
        'woff2': 'font/woff2'
    };
    
    return mimeTypes[extension] || 'application/octet-stream';
}

// Function to modify HTML content using regex instead of DOM API
function modifyHtmlContentWithRegex(htmlContent, filePath) {
    let modifiedContent = htmlContent;
    let scriptCounter = 0;
    const baseDir = filePath.includes("/")
        ? filePath.substring(0, filePath.lastIndexOf("/") + 1)
        : "";

    // Regular expression to find inline scripts (scripts without src attribute)
    const inlineScriptRegex = /<script(?!\s+src=)([\s\S]*?)>([\s\S]*?)<\/script>/gi;

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
            return `<script${attributes} src="${chrome.runtime.getURL(scriptFileName)}"></script>`;
        }
    );

    return modifiedContent;
}

// Listen for messages from the popup or player pages
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "launchUnity") {
        chrome.tabs.create({
            url: chrome.runtime.getURL("index.html"),
        });
        sendResponse({ success: true });
        return true;
    }

    // Handle database operations
    if (message.action === "getFile") {
        getFileFromDB(message.filePath)
            .then(content => sendResponse({ success: true, content }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    if (message.action === "storeFile") {
        storeFileInDB(message.fileName, message.content)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
        return true;
    }

    return false;
});
