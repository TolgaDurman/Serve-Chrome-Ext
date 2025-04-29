// Constants
const DEFAULT_OPTIONS = {
    url: 'https://www.buymeacoffee.com/tolgadurman',
    text: 'Buy me a coffee',
    emoji: '☕',
    wrapperClass: 'bmc-wrapper'
};

// Button Creation Module
const ButtonCreator = {
    createWrapper(className) {
        const wrapper = document.createElement('div');
        wrapper.className = className;
        return wrapper;
    },

    createButton(url) {
        const button = document.createElement('a');
        button.href = url;
        button.target = '_blank';
        button.className = 'bmc-button';
        return button;
    },

    createEmoji(emoji) {
        const emojiElement = document.createElement('span');
        emojiElement.textContent = emoji;
        emojiElement.className = 'bmc-emoji';
        return emojiElement;
    },

    createText(text) {
        const textElement = document.createElement('span');
        textElement.textContent = text;
        return textElement;
    }
};

// Main Button Injection Module
export function injectBmcButton(container, options = {}) {
    if (!container) {
        console.error('Container element is required for BMC button injection');
        return;
    }

    try {
        const config = { ...DEFAULT_OPTIONS, ...options };
        const { url, text, emoji, wrapperClass } = config;

        const wrapper = ButtonCreator.createWrapper(wrapperClass);
        const button = ButtonCreator.createButton(url);
        const emojiElement = ButtonCreator.createEmoji(emoji);
        const textElement = ButtonCreator.createText(text);

        button.appendChild(emojiElement);
        button.appendChild(textElement);
        wrapper.appendChild(button);
        container.appendChild(wrapper);
    } catch (error) {
        console.error('Error injecting BMC button:', error);
    }
} 