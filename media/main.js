(function () {
	const vscode = acquireVsCodeApi();

	// Preserve search state and selection across refreshes
	let currentSearchTerm = "";
	let selectedExtensionId = "";
	let isSearching = false;

	// Get references to DOM elements
	const refreshBtn = document.getElementById("refresh-btn");
	const addBtn = document.getElementById("add-btn");
	const searchInput = document.getElementById("search-input");
	const itemsContainer = document.querySelector(".items-container");

	// Restore search state and selection on load
	function restoreSearchState() {
		const state = vscode.getState();
		if (state && state.searchTerm !== undefined) {
			currentSearchTerm = state.searchTerm;
			if (searchInput) {
				searchInput.value = currentSearchTerm;
				// Don't auto-trigger search on restore to avoid unwanted API calls
				if (currentSearchTerm.length <= 2) {
					filterItems(currentSearchTerm);
				}
			}
		}
		if (state && state.selectedExtensionId) {
			selectedExtensionId = state.selectedExtensionId;
			updateSelectionUI(selectedExtensionId);
		}
	}

	// Save search state and selection
	function saveState(searchTerm, extensionId) {
		if (searchTerm !== undefined) {
			currentSearchTerm = searchTerm;
		}
		if (extensionId !== undefined) {
			selectedExtensionId = extensionId;
		}
		vscode.setState({
			searchTerm: currentSearchTerm,
			selectedExtensionId: selectedExtensionId,
		});
	}

	// Clear search state completely
	function clearSearchState() {
		currentSearchTerm = "";
		selectedExtensionId = "";
		isSearching = false;
		if (searchInput) {
			searchInput.value = "";
		}
		saveState("", "");
		filterItems("");
		updateSelectionUI("");
		showSearchingState(false);
		updateSearchInfo("", 0, false);
	}

	// Update the UI to show selected item
	function updateSelectionUI(extensionId) {
		// Remove previous selection
		document.querySelectorAll(".item.selected").forEach((item) => {
			item.classList.remove("selected");
		});

		// Add selection to new item
		if (extensionId) {
			const selectedItem = document.querySelector(
				`[data-item-id="${extensionId}"]`
			);
			if (selectedItem) {
				selectedItem.classList.add("selected");
			}
		}
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

	// Enhanced search functionality with unified search
	if (searchInput) {
		let searchTimeout;

		searchInput.addEventListener("input", (e) => {
			const searchTerm = e.target.value.toLowerCase();
			saveState(searchTerm, undefined);

			// Clear existing timeout
			if (searchTimeout) {
				clearTimeout(searchTimeout);
			}

			// For local-only filtering (short queries), filter immediately
			if (searchTerm.length <= 2) {
				filterItems(searchTerm);
				return;
			}

			// For longer queries, debounce and trigger unified search
			searchTimeout = setTimeout(() => {
				triggerUnifiedSearch(searchTerm);
			}, 300);
		});

		// Add clear button functionality
		searchInput.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				clearSearchState();
				searchInput.blur();
			}
		});
	}

	/**
	 * Trigger unified search (local + remote)
	 */
	function triggerUnifiedSearch(query) {
		if (isSearching) return;

		isSearching = true;
		currentSearchTerm = query;

		// Show loading state for remote searches
		if (query.length > 2) {
			showSearchingState(true);
		}

		// Send search request to extension
		vscode.postMessage({
			command: "search",
			query: query,
		});
	}

	/**
	 * Show searching state
	 */
	function showSearchingState(show) {
		let searchingState = document.querySelector(".searching-state");

		if (show && !searchingState) {
			searchingState = document.createElement("div");
			searchingState.className = "searching-state";
			searchingState.innerHTML = `
                <div class="codicon codicon-sync spin"></div>
                <div>Searching extensions...</div>
                <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">
					Searching local files and OpenVSX registry
				</div>
            `;
			itemsContainer.appendChild(searchingState);
		} else if (!show && searchingState) {
			searchingState.remove();
		}
	}

	/**
	 * Enhanced filter items for local-only searches
	 */
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
			const version =
				item.querySelector(".version")?.textContent?.toLowerCase() || "";

			const isMatch =
				!searchTerm ||
				title.includes(searchTerm) ||
				description.includes(searchTerm) ||
				author.includes(searchTerm) ||
				version.includes(searchTerm);

			if (isMatch) {
				item.style.display = "flex";
				item.style.visibility = "visible";
				visibleCount++;
			} else {
				item.style.display = "none";
				item.style.visibility = "hidden";
			}
		});

		showEmptyState(visibleCount === 0 && searchTerm !== "");
	}

	/**
	 * Enhanced empty state with search suggestions
	 */
	function showEmptyState(show) {
		let emptyState = document.querySelector(".empty-state");

		if (show && !emptyState) {
			emptyState = document.createElement("div");
			emptyState.className = "empty-state";
			emptyState.innerHTML = `
                <div class="codicon codicon-search"></div>
                <div>No extensions found</div>
                <div style="font-size: 11px; margin-top: 4px; opacity: 0.7;">
					Try different search terms or browse OpenVSX registry
				</div>
				<div style="margin-top: 8px;">
					<button class="empty-action-btn" onclick="clearSearchAndBrowse()">
						<span class="codicon codicon-globe"></span>
						Browse Popular Extensions
					</button>
				</div>
            `;
			itemsContainer.appendChild(emptyState);
		} else if (!show && emptyState) {
			emptyState.remove();
		}
	}

	/**
	 * Clear search and show popular extensions
	 */
	window.clearSearchAndBrowse = function () {
		clearSearchState();
		// Trigger search for popular extensions
		vscode.postMessage({
			command: "showPopular",
		});
	};

	/**
	 * Update search info display
	 */
	function updateSearchInfo(query, count, hasRemoteResults) {
		let searchInfo = document.querySelector(".search-info");
		if (!searchInfo) return;

		if (query && query.length > 0) {
			const remoteText = hasRemoteResults ? " (including OpenVSX)" : "";
			searchInfo.innerHTML = `
				<span class="search-results-info">
					Found ${count} extension${count === 1 ? "" : "s"} for "${query}"${remoteText}
				</span>
				${
					hasRemoteResults
						? '<div class="remote-indicator"><span class="codicon codicon-cloud"></span> Remote results included</div>'
						: ""
				}
			`;
		} else {
			searchInfo.innerHTML = `
				<span class="search-hint">Search includes both local .vsix files and OpenVSX registry</span>
			`;
		}
	}

	// Set up item event listeners
	setupItemEventListeners();

	/**
	 * Enhanced item event listeners with remote extension support
	 */
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
			const isRemote = item.classList.contains("remote-extension");

			// Main item click (but not on buttons)
			item.addEventListener("click", (e) => {
				if (
					!e.target.closest(".action-btn") &&
					!e.target.closest(".install-btn") &&
					!e.target.closest(".update-btn")
				) {
					selectedExtensionId = itemId;
					saveState(undefined, selectedExtensionId);
					updateSelectionUI(selectedExtensionId);

					vscode.postMessage({
						command: "itemClicked",
						itemId: itemId,
					});
				}
			});

			// Delete button (only for local extensions)
			const deleteBtn = item.querySelector(".delete-btn");
			if (deleteBtn && !isRemote) {
				deleteBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					vscode.postMessage({
						command: "deleteItem",
						itemId: itemId,
					});
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

			// Install button
			const installBtn = item.querySelector(".install-btn");
			if (installBtn) {
				installBtn.addEventListener("click", (e) => {
					e.stopPropagation();

					// Show different loading text for remote extensions
					const loadingText = isRemote
						? '<span class="codicon codicon-sync spin"></span> Downloading...'
						: '<span class="codicon codicon-sync spin"></span> Installing...';

					installBtn.innerHTML = loadingText;
					installBtn.disabled = true;

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

					const loadingText = isRemote
						? '<span class="codicon codicon-sync spin"></span> Downloading...'
						: '<span class="codicon codicon-sync spin"></span> Updating...';

					updateBtn.innerHTML = loadingText;
					updateBtn.disabled = true;

					vscode.postMessage({
						command: "updateItem",
						itemId: itemId,
					});
				});
			}
		});
	}

	function showLoadingState(show) {
		let loadingState = document.querySelector(".loading");

		if (show && !loadingState) {
			loadingState = document.createElement("div");
			loadingState.className = "loading";
			loadingState.innerHTML = `
                <div class="codicon codicon-sync spin"></div>
                <div>Scanning directories...</div>
            `;
			itemsContainer.appendChild(loadingState);
		} else if (!show && loadingState) {
			loadingState.remove();
		}
	}

	// Enhanced keyboard shortcuts with search awareness
	document.addEventListener("keydown", (e) => {
		// Escape to clear search and selection - only when search input is focused
		if (e.key === "Escape" && document.activeElement === searchInput) {
			e.preventDefault();
			clearSearchState();
			searchInput.blur();
			return;
		}

		// Arrow key navigation - only when search input is not focused
		if (
			(e.key === "ArrowUp" || e.key === "ArrowDown") &&
			document.activeElement !== searchInput
		) {
			e.preventDefault();
			navigateSelection(e.key === "ArrowDown");
		}

		// Enter to open selected item - only when search input is not focused
		if (
			e.key === "Enter" &&
			selectedExtensionId &&
			document.activeElement !== searchInput
		) {
			e.preventDefault();
			vscode.postMessage({
				command: "itemClicked",
				itemId: selectedExtensionId,
			});
		}

		// Ctrl+K to focus search
		if (e.ctrlKey && e.key === "k") {
			e.preventDefault();
			if (searchInput) {
				searchInput.focus();
				searchInput.select();
			}
		}
	});

	// Navigation with arrow keys
	function navigateSelection(goDown) {
		const visibleItems = Array.from(document.querySelectorAll(".item")).filter(
			(item) => item.style.display !== "none"
		);

		if (visibleItems.length === 0) return;

		let currentIndex = -1;
		if (selectedExtensionId) {
			currentIndex = visibleItems.findIndex(
				(item) => item.getAttribute("data-item-id") === selectedExtensionId
			);
		}

		let newIndex;
		if (goDown) {
			newIndex = currentIndex < visibleItems.length - 1 ? currentIndex + 1 : 0;
		} else {
			newIndex = currentIndex > 0 ? currentIndex - 1 : visibleItems.length - 1;
		}

		const newSelectedItem = visibleItems[newIndex];
		if (newSelectedItem) {
			const newSelectedId = newSelectedItem.getAttribute("data-item-id");
			selectedExtensionId = newSelectedId;
			saveState(undefined, selectedExtensionId);
			updateSelectionUI(selectedExtensionId);

			// Scroll item into view
			newSelectedItem.scrollIntoView({
				behavior: "smooth",
				block: "nearest",
			});
		}
	}

	// Enhanced message handling for unified search
	window.addEventListener("message", (event) => {
		const message = event.data;
		console.log("Webview received message:", message.command);

		switch (message.command) {
			case "refresh":
				// Manual refresh triggered
				showLoadingState(false);
				showSearchingState(false);
				isSearching = false;
				setTimeout(() => {
					console.log("Setting up event listeners after refresh");
					setupItemEventListeners();
					restoreSearchState();
					showToast("Extensions refreshed", "success");
				}, 50);
				break;

			case "scanComplete":
				// Automatic scan completed
				console.log(`Scan complete: ${message.count} extensions`);
				showLoadingState(false);
				showSearchingState(false);
				isSearching = false;
				setTimeout(() => {
					console.log("Setting up event listeners after scan complete");
					setupItemEventListeners();
					restoreSearchState();

					// Restore selection if provided
					if (message.selectedExtensionId) {
						selectedExtensionId = message.selectedExtensionId;
						updateSelectionUI(selectedExtensionId);
					}

					if (message.count !== undefined) {
						const isManualRefresh = document.querySelector(".loading") !== null;
						if (isManualRefresh) {
							showToast(
								`Found ${message.count} extension${
									message.count === 1 ? "" : "s"
								}`,
								"success"
							);
						}
					}
				}, 50);
				break;

			case "searchStarted":
				// Search initiated
				showSearchingState(true);
				break;

			case "searchComplete":
				// Unified search completed
				console.log(`Search complete: ${message.count} extensions`);
				showSearchingState(false);
				isSearching = false;

				setTimeout(() => {
					setupItemEventListeners();
					restoreSearchState();

					// Show search results info
					if (message.hasRemoteResults) {
						showToast(
							`Found ${message.count} extensions (including OpenVSX results)`,
							"info"
						);
					}

					// Update search info display
					updateSearchInfo(
						message.query,
						message.count,
						message.hasRemoteResults
					);
				}, 50);
				break;

			case "searchError":
				// Search error occurred
				console.error("Search error:", message.message);
				showSearchingState(false);
				isSearching = false;
				showToast(message.message, "error");
				break;

			case "setSelection":
				// Set selection from sidebar provider
				if (message.selectedExtensionId) {
					selectedExtensionId = message.selectedExtensionId;
					saveState(undefined, selectedExtensionId);
					updateSelectionUI(selectedExtensionId);
				}
				break;

			case "clearSearch":
				// Clear search from external command
				clearSearchState();
				break;

			case "installComplete":
				console.log("Install complete");
				// Reset install button states
				document.querySelectorAll(".install-btn[disabled]").forEach((btn) => {
					btn.innerHTML =
						'<span class="codicon codicon-cloud-download"></span> Install';
					btn.disabled = false;
				});
				break;

			case "updateComplete":
				console.log("Update complete");
				// Reset update button states
				document.querySelectorAll(".update-btn[disabled]").forEach((btn) => {
					btn.innerHTML =
						'<span class="codicon codicon-arrow-up"></span> Update';
					btn.disabled = false;
				});
				break;

			case "error":
				console.error("Extension error:", message.message);
				showLoadingState(false);
				showSearchingState(false);
				isSearching = false;
				// Reset button states on error
				document
					.querySelectorAll(".install-btn[disabled], .update-btn[disabled]")
					.forEach((btn) => {
						if (btn.classList.contains("install-btn")) {
							btn.innerHTML =
								'<span class="codicon codicon-cloud-download"></span> Install';
						} else {
							btn.innerHTML =
								'<span class="codicon codicon-arrow-up"></span> Update';
						}
						btn.disabled = false;
					});
				showToast(message.message || "An error occurred", "error");
				break;
		}
	});

	// Add keyboard shortcut hints
	function addKeyboardHints() {
		const searchContainer = document.querySelector(".search-container");
		if (searchContainer && !document.querySelector(".keyboard-hints")) {
			const hints = document.createElement("div");
			hints.className = "keyboard-hints";
			hints.innerHTML = `
				<span class="hint">Ctrl+K to focus search</span>
				<span class="hint">↑↓ to navigate</span>
				<span class="hint">Enter to open</span>
				<span class="hint">Esc to clear</span>
			`;
			searchContainer.appendChild(hints);
		}
	}

	// Enhanced context menu with remote extension awareness
	document.addEventListener("contextmenu", (e) => {
		const item = e.target.closest(".item");
		if (item) {
			e.preventDefault();
			const itemId = item.getAttribute("data-item-id");
			const isRemote = item.classList.contains("remote-extension");
			const isInstalled = item.classList.contains("installed");

			// Set selection on right-click
			selectedExtensionId = itemId;
			saveState(undefined, selectedExtensionId);
			updateSelectionUI(selectedExtensionId);

			// Create context menu
			const contextMenu = document.createElement("div");
			contextMenu.className = "context-menu";

			// Position the menu
			const x = Math.min(e.clientX, window.innerWidth - 150);
			const y = Math.min(e.clientY, window.innerHeight - 100);
			contextMenu.style.left = `${x}px`;
			contextMenu.style.top = `${y}px`;

			const menuItems = [
				{ label: "Show Details", command: "itemClicked", icon: "info" },
			];

			// Add source-specific menu items
			if (isRemote) {
				menuItems.push({
					label: "View on OpenVSX",
					command: "viewOnOpenVSX",
					icon: "link-external",
				});
			}

			if (!isInstalled) {
				menuItems.push({
					label: isRemote ? "Download & Install" : "Install",
					command: "installItem",
					icon: "cloud-download",
				});
			}

			menuItems.forEach((menuItem) => {
				const menuOption = document.createElement("div");
				menuOption.className = "context-menu-item";

				menuOption.innerHTML = `
                    <span class="codicon codicon-${menuItem.icon}"></span>
                    ${menuItem.label}
                `;

				menuOption.addEventListener("click", () => {
					if (menuItem.command === "viewOnOpenVSX") {
						// Special handling for OpenVSX link
						const namespace = item.dataset.namespace;
						const name = itemId.split(".")[1];
						if (namespace && name) {
							vscode.postMessage({
								command: "openUrl",
								url: `https://open-vsx.org/extension/${namespace}/${name}`,
							});
						}
					} else {
						vscode.postMessage({
							command: menuItem.command,
							itemId: itemId,
						});
					}
					document.body.removeChild(contextMenu);
				});

				contextMenu.appendChild(menuOption);
			});

			document.body.appendChild(contextMenu);

			// Remove context menu when clicking elsewhere
			const removeContextMenu = (e) => {
				if (!contextMenu.contains(e.target)) {
					if (document.body.contains(contextMenu)) {
						document.body.removeChild(contextMenu);
					}
					document.removeEventListener("click", removeContextMenu);
				}
			};

			setTimeout(() => {
				document.addEventListener("click", removeContextMenu);
			}, 100);
		}
	});

	// Initialize on load
	document.addEventListener("DOMContentLoaded", () => {
		console.log("DOM loaded, restoring search state");
		restoreSearchState();
		addKeyboardHints();
	});

	// Also restore immediately if DOM is already loaded
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", () => {
			restoreSearchState();
			addKeyboardHints();
		});
	} else {
		console.log("DOM already loaded, restoring search state immediately");
		restoreSearchState();
		addKeyboardHints();
	}

	// Add visual feedback for actions - UPDATED to use CSS classes
	function showToast(message, type = "info") {
		const toast = document.createElement("div");
		toast.className = `toast ${type}`;
		toast.textContent = message;
		document.body.appendChild(toast);

		// Show toast
		setTimeout(() => toast.classList.add("visible"), 10);

		// Hide and remove toast
		setTimeout(
			() => {
				toast.classList.remove("visible");
				setTimeout(() => {
					if (document.body.contains(toast)) {
						document.body.removeChild(toast);
					}
				}, 300);
			},
			type === "error" ? 4000 : 2000
		);
	}

	// Expose enhanced functions globally for debugging
	window.vscodeExtension = {
		filterItems,
		showToast,
		showLoadingState,
		showSearchingState,
		setupItemEventListeners,
		restoreSearchState,
		updateSelectionUI,
		clearSearchState,
		triggerUnifiedSearch,
		updateSearchInfo,
		currentSearchTerm: () => currentSearchTerm,
		selectedExtensionId: () => selectedExtensionId,
		isSearching: () => isSearching,
	};

	// Log when the script initializes
	console.log("Enhanced main.js initialized with unified search support");

	// Set up initial event listeners and restore state
	setTimeout(() => {
		setupItemEventListeners();
		restoreSearchState();
		addKeyboardHints();
		console.log("Initial setup complete with unified search");
	}, 100);
})();
