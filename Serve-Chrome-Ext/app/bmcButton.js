// Injects a Buy Me a Coffee button into the given container element
export function injectBmcButton(container, options = {}) {
    const {
        url = 'https://www.buymeacoffee.com/tolgadurman',
        text = 'Buy me a coffee',
        emoji = '☕',
        wrapperClass = 'bmc-wrapper',
    } = options;

    // Create wrapper for Buy Me a Coffee button
    const bmcWrapper = document.createElement('div');
    bmcWrapper.className = wrapperClass;

    // Create Buy Me a Coffee button
    const bmcButton = document.createElement('a');
    bmcButton.href = url;
    bmcButton.target = '_blank';
    bmcButton.className = 'bmc-button';
    
    const coffeeEmoji = document.createElement('span');
    coffeeEmoji.textContent = emoji;
    coffeeEmoji.className = 'bmc-emoji';
    
    const buttonText = document.createElement('span');
    buttonText.textContent = text;
    
    bmcButton.appendChild(coffeeEmoji);
    bmcButton.appendChild(buttonText);
    bmcWrapper.appendChild(bmcButton);
    container.appendChild(bmcWrapper);
} 