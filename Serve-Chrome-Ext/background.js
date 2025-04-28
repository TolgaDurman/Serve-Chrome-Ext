// Background service worker for Unity WebGL launcher
let tabWithFileAccess = null;

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
    // Use message passing system to get the file content
    const response = await sendMessageToFileAccessTab(filePath);

    if (response && response.success) {
      // Convert data back to proper format
      let content;
      if (response.isText) {
        content = response.content;

        // If this is HTML content, modify it to extract inline scripts
        if (response.contentType === "text/html") {
          content = modifyHtmlContentWithRegex(content, filePath);
        }
      } else {
        content = base64ToArrayBuffer(response.content);
      }

      // Create response with appropriate headers
      return new Response(content, {
        status: 200,
        headers: {
          "Content-Type": response.contentType,
          "Cross-Origin-Embedder-Policy": "require-corp",
          "Cross-Origin-Opener-Policy": "same-origin",
        },
      });
    } else {
      console.warn(`File not found: ${filePath}`);
      return new Response("File not found", { status: 404 });
    }
  } catch (error) {
    console.error("Error serving Unity file:", error);
    return new Response("Error: " + error.message, { status: 500 });
  }
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

// Function to send a message to the tab with file access
async function sendMessageToFileAccessTab(filePath) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({}, function (tabs) {
      // Try to find the player tab with file access
      let playerTab = tabs.find(
        (tab) =>
          tab.url &&
          tab.url.includes(chrome.runtime.id) &&
          tab.url.includes("player.html")
      );

      if (!playerTab) {
        chrome.tabs.create({ url: chrome.runtime.getURL("app/rejected.html") });
        reject(new Error("No player tab found"));
        return;
      }

      // Set up a listener for the response
      const messageListener = function (message, sender) {
        if (message.response && message.filePath === filePath) {
          chrome.runtime.onMessage.removeListener(messageListener);
          resolve(message);
        }
      };

      chrome.runtime.onMessage.addListener(messageListener);

      // Send the request for file content
      chrome.tabs
        .sendMessage(playerTab.id, {
          action: "getFile",
          filePath: filePath,
        })
        .catch((err) => {
          chrome.runtime.onMessage.removeListener(messageListener);
          reject(err);
        });

      // Set a timeout in case there's no response
      setTimeout(() => {
        chrome.runtime.onMessage.removeListener(messageListener);
        reject(new Error(`Timeout while requesting file: ${filePath}`));
      }, 20000); // 20 second timeout
    });
  });
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

  if (message.action === "registerFileAccessTab") {
    tabWithFileAccess = sender.tab.id;
    sendResponse({ success: true });
    return true;
  }

  return false;
});
