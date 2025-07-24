(function () {
	const vscode = acquireVsCodeApi();

	// Preserve search state across refreshes
	let currentSearchTerm = "";

	// Get references to DOM elements
	const refreshBtn = document.getElementById("refresh-btn");
	const addBtn = document.getElementById("add-btn");
	const searchInput = document.getElementById("search-input");
	const itemsContainer = document.querySelector(".items-container");

	// Restore search state on load
	function restoreSearchState() {
		const state = vscode.getState();
		if (state && state.searchTerm) {
			currentSearchTerm = state.searchTerm;
			if (searchInput) {
				searchInput.value = currentSearchTerm;
				filterItems(currentSearchTerm);
			}
		}
	}

	// Save search state
	function saveSearchState(searchTerm) {
		currentSearchTerm = searchTerm;
		vscode.setState({ searchTerm: searchTerm });
	}

	// Set up event listeners
	if (refreshBtn) {
		refreshBtn.addEventListener("click", () => {
			vscode.postMessage({
				command: "refresh",
			});
		});
	}

	if (addBtn) {
		addBtn.addEventListener("click", () => {
			vscode.postMessage({
				command: "addItem",
			});
		});
	}

	// Search functionality with state preservation
	if (searchInput) {
		searchInput.addEventListener("input", (e) => {
			const searchTerm = e.target.value.toLowerCase();
			saveSearchState(searchTerm);
			filterItems(searchTerm);
		});
	}

	// Set up item event listeners
	setupItemEventListeners();

	function setupItemEventListeners() {
		// Remove existing listeners to prevent duplicates
		const existingItems = document.querySelectorAll(".item");
		existingItems.forEach((item) => {
			// Clone node to remove all event listeners
			const newItem = item.cloneNode(true);
			item.parentNode.replaceChild(newItem, item);
		});

		// Item click handlers
		document.querySelectorAll(".item").forEach((item) => {
			const itemId = item.getAttribute("data-item-id");

			// Main item click (but not on buttons)
			item.addEventListener("click", (e) => {
				if (
					!e.target.closest(".action-btn") &&
					!e.target.closest(".install-btn") &&
					!e.target.closest(".update-btn")
				) {
					vscode.postMessage({
						command: "itemClicked",
						itemId: itemId,
					});
				}
			});

			// Delete button
			const deleteBtn = item.querySelector(".delete-btn");
			if (deleteBtn) {
				deleteBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					if (confirm("Are you sure you want to uninstall this extension?")) {
						vscode.postMessage({
							command: "deleteItem",
							itemId: itemId,
						});
					}
				});
			}

			// Toggle status button
			const toggleBtn = item.querySelector(".toggle-status-btn");
			if (toggleBtn) {
				toggleBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					vscode.postMessage({
						command: "toggleStatus",
						itemId: itemId,
					});
				});
			}

			// Open in editor button
			const openBtn = item.querySelector(".open-btn");
			if (openBtn) {
				openBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					vscode.postMessage({
						command: "openInEditor",
						itemId: itemId,
					});
				});
			}

			// Install button
			const installBtn = item.querySelector(".install-btn");
			if (installBtn) {
				installBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					vscode.postMessage({
						command: "installItem",
						itemId: itemId,
					});
				});
			}

			// Update button
			const updateBtn = item.querySelector(".update-btn");
			if (updateBtn) {
				updateBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					vscode.postMessage({
						command: "updateItem",
						itemId: itemId,
					});
				});
			}
		});
	}

	function filterItems(searchTerm) {
		const items = document.querySelectorAll(".item");
		let visibleCount = 0;

		items.forEach((item) => {
			const title =
				item.querySelector(".item-title")?.textContent?.toLowerCase() || "";
			const description =
				item.querySelector(".item-description")?.textContent?.toLowerCase() ||
				"";
			const author =
				item.querySelector(".author-name")?.textContent?.toLowerCase() || "";

			const isMatch =
				!searchTerm || // Show all if no search term
				title.includes(searchTerm) ||
				description.includes(searchTerm) ||
				author.includes(searchTerm);

			if (isMatch) {
				item.style.display = "flex"; // Use flex instead of block for proper layout
				item.style.visibility = "visible";
				visibleCount++;
			} else {
				item.style.display = "none";
				item.style.visibility = "hidden";
			}
		});

		// Show/hide empty state
		showEmptyState(visibleCount === 0 && searchTerm !== "");
	}

	function showEmptyState(show) {
		let emptyState = document.querySelector(".empty-state");

		if (show && !emptyState) {
			emptyState = document.createElement("div");
			emptyState.className = "empty-state";
			emptyState.innerHTML = `
                <div class="codicon codicon-search"></div>
                <div>No extensions found</div>
                <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">Try adjusting your search terms</div>
            `;
			itemsContainer.appendChild(emptyState);
		} else if (!show && emptyState) {
			emptyState.remove();
		}
	}

	// Keyboard shortcuts
	document.addEventListener("keydown", (e) => {
		// Ctrl/Cmd + F to focus search
		if ((e.ctrlKey || e.metaKey) && e.key === "f") {
			e.preventDefault();
			if (searchInput) {
				searchInput.focus();
				searchInput.select();
			}
		}

		// Escape to clear search
		if (e.key === "Escape" && document.activeElement === searchInput) {
			searchInput.value = "";
			saveSearchState("");
			filterItems("");
			searchInput.blur();
		}

		// Ctrl/Cmd + R to refresh
		if ((e.ctrlKey || e.metaKey) && e.key === "r") {
			e.preventDefault();
			vscode.postMessage({ command: "refresh" });
		}

		// Ctrl/Cmd + N to add new item
		if ((e.ctrlKey || e.metaKey) && e.key === "n") {
			e.preventDefault();
			vscode.postMessage({ command: "addItem" });
		}
	});

	// Handle messages from the extension
	window.addEventListener("message", (event) => {
		const message = event.data;
		switch (message.command) {
			case "refresh":
				// Re-setup event listeners after refresh and restore search
				setTimeout(() => {
					setupItemEventListeners();
					restoreSearchState();
				}, 50);
				break;
		}
	});

	// Initialize on load
	document.addEventListener("DOMContentLoaded", () => {
		restoreSearchState();
	});

	// Also restore immediately if DOM is already loaded
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", restoreSearchState);
	} else {
		restoreSearchState();
	}

	// Add some visual feedback for actions
	function showToast(message, type = "info") {
		const toast = document.createElement("div");
		toast.style.cssText = `
            position: fixed;
            top: 10px;
            right: 10px;
            background: var(--vscode-notifications-background);
            color: var(--vscode-notifications-foreground);
            border: 1px solid var(--vscode-notifications-border);
            border-radius: 4px;
            padding: 8px 12px;
            font-size: 12px;
            z-index: 1000;
            opacity: 0;
            transition: opacity 0.3s ease;
        `;

		if (type === "error") {
			toast.style.borderColor = "var(--vscode-errorForeground)";
			toast.style.color = "var(--vscode-errorForeground)";
		}

		toast.textContent = message;
		document.body.appendChild(toast);

		// Fade in
		setTimeout(() => (toast.style.opacity = "1"), 10);

		// Fade out and remove
		setTimeout(() => {
			toast.style.opacity = "0";
			setTimeout(() => {
				if (document.body.contains(toast)) {
					document.body.removeChild(toast);
				}
			}, 300);
		}, 2000);
	}

	// Expose some functions globally for debugging
	window.vscodeExtension = {
		filterItems,
		showToast,
		setupItemEventListeners,
		restoreSearchState,
		currentSearchTerm: () => currentSearchTerm,
	};
})();
