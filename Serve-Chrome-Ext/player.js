// Global directory handle that we can reference
let globalDirectoryHandle = null;

// Status message handler
function showStatus(message, isError = false) {
    const status = document.getElementById('status');
    const button = document.getElementById('select-folder');
    
    if (message === 'loading') {
        button.innerHTML = '<div class="loading"></div> Loading...';
        button.disabled = true;
        status.style.display = 'none';
    } else {
        button.innerHTML = `
            <svg class="icon" viewBox="0 0 24 24">
                <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            </svg>
            Select WebGL Folder
        `;
        button.disabled = false;
        
        if (message) {
            status.textContent = message;
            status.style.display = 'block';
            status.className = 'status ' + (isError ? 'error' : 'success');
        } else {
            status.style.display = 'none';
        }
    }
}

// Register this tab as having file access
function registerAsFileAccessTab() {
    chrome.runtime.sendMessage({
        action: 'registerFileAccessTab'
    });
}

// Check if a directory contains index.html
async function checkForIndexHtml(dirHandle, path = '') {
    for await (const entry of dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase() === 'index.html') {
            return true;
        } else if (entry.kind === 'directory') {
            const subDirHandle = await dirHandle.getDirectoryHandle(entry.name);
            const subResult = await checkForIndexHtml(subDirHandle, path ? `${path}/${entry.name}` : entry.name);
            if (subResult) return true;
        }
    }
    return false;
}

// Get file from directory handle by path
async function getFileFromPath(dirHandle, path) {
    const parts = path.split('/').filter(part => part !== '');
    
    // Navigate to the correct subdirectory
    let currentHandle = dirHandle;
    for (let i = 0; i < parts.length - 1; i++) {
        try {
            currentHandle = await currentHandle.getDirectoryHandle(parts[i]);
        } catch (err) {
            throw new Error(`Directory not found: ${parts[i]}`);
        }
    }
    
    // Get the file from the current directory
    try {
        const fileName = parts[parts.length - 1];
        const fileHandle = await currentHandle.getFileHandle(fileName);
        return await fileHandle.getFile();
    } catch (err) {
        throw new Error(`File not found: ${parts[parts.length - 1]}`);
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

// Handle folder selection and Unity WebGL launch
async function pickFolderAndLaunchUnity() {
    try {
        showStatus('loading');
        
        // Show the directory picker to let the user select a folder
        const dirHandle = await window.showDirectoryPicker();
        
        // Check if the selected folder contains a Unity WebGL build (index.html)
        const hasIndexHtml = await checkForIndexHtml(dirHandle);
        
        if (!hasIndexHtml) {
            showStatus('No index.html found in the selected folder. Please select a valid Unity WebGL build folder.', true);
            return;
        }
        
        // Save the directory handle for later use
        globalDirectoryHandle = dirHandle;
        
        // Register this tab as having file access
        registerAsFileAccessTab();
        
        // Launch the Unity game in a new tab
        chrome.runtime.sendMessage({action: 'launchUnity'}, function(response) {
            if (response && response.success) {
                showStatus('Unity WebGL game launched successfully! Keep this tab open to provide file access.');
            } else {
                showStatus('Failed to launch Unity WebGL game.', true);
            }
        });
        
    } catch (err) {
        console.error('Error:', err);
        showStatus(err.message || 'An error occurred while processing the WebGL build.', true);
    }
}

// Listen for file requests
chrome.runtime.onMessage.addListener(async (message, sender, sendResponse) => {
    if (message.action === 'getFile' && globalDirectoryHandle) {
        // Send immediate response to keep the message channel open
        sendResponse({processing: true});
        
        try {
            const file = await getFileFromPath(globalDirectoryHandle, message.filePath);
            const contentType = file.type || getMimeType(file.name);
            
            // Determine if this is a text or binary file
            const isText = contentType.startsWith('text/') || 
                          contentType === 'application/javascript' || 
                          contentType === 'application/json';
            
            let content;
            if (isText) {
                content = await file.text();
            } else {
                // Convert binary to base64 for transmission
                const arrayBuffer = await file.arrayBuffer();
                const bytes = new Uint8Array(arrayBuffer);
                let binary = '';
                for (let i = 0; i < bytes.byteLength; i++) {
                    binary += String.fromCharCode(bytes[i]);
                }
                content = btoa(binary);
            }
            
            chrome.runtime.sendMessage({
                response: true,
                success: true,
                filePath: message.filePath,
                content: content,
                contentType: contentType,
                isText: isText
            });
        } catch (error) {
            chrome.runtime.sendMessage({
                response: true,
                success: false,
                filePath: message.filePath,
                error: error.message
            });
        }
        
        return true;
    }
});

// Add event listener for the select folder button and register as file access tab
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('select-folder').addEventListener('click', pickFolderAndLaunchUnity);
    
    // Check if we have previously stored directory handle
    if (globalDirectoryHandle) {
        registerAsFileAccessTab();
    }
});