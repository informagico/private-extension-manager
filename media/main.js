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
					// Add loading state
					installBtn.innerHTML =
						'<span class="codicon codicon-sync spin"></span> Installing...';
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
					// Add loading state
					updateBtn.innerHTML =
						'<span class="codicon codicon-sync spin"></span> Updating...';
					updateBtn.disabled = true;

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
			const version =
				item.querySelector(".version")?.textContent?.toLowerCase() || "";

			const isMatch =
				!searchTerm || // Show all if no search term
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
		} else if (!show && emptyState && show !== undefined) {
			emptyState.remove();
		}
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
			showLoadingState(true);
			vscode.postMessage({ command: "refresh" });
		}

		// Ctrl/Cmd + N to add new directory
		if ((e.ctrlKey || e.metaKey) && e.key === "n") {
			e.preventDefault();
			vscode.postMessage({ command: "addItem" });
		}
	});

	// Handle messages from the extension
	window.addEventListener("message", (event) => {
		const message = event.data;
		console.log("Webview received message:", message.command);

		switch (message.command) {
			case "refresh":
				// Manual refresh triggered
				showLoadingState(false);
				setTimeout(() => {
					console.log("Setting up event listeners after refresh");
					setupItemEventListeners();
					restoreSearchState();
					showToast("Extensions refreshed", "success");
				}, 50);
				break;

			case "scanComplete":
				// Automatic scan completed (from storage provider changes)
				console.log(`Scan complete: ${message.count} extensions`);
				showLoadingState(false);
				setTimeout(() => {
					console.log("Setting up event listeners after scan complete");
					setupItemEventListeners();
					restoreSearchState();
					if (message.count !== undefined) {
						// Only show toast for manual refreshes, not automatic ones
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

			case "installComplete":
				console.log("Install complete");
				// Reset install button states
				document.querySelectorAll(".install-btn[disabled]").forEach((btn) => {
					btn.innerHTML =
						'<span class="codicon codicon-cloud-download"></span> Install';
					btn.disabled = false;
				});
				// UI will be refreshed automatically via storage provider changes
				break;

			case "updateComplete":
				console.log("Update complete");
				// Reset update button states
				document.querySelectorAll(".update-btn[disabled]").forEach((btn) => {
					btn.innerHTML =
						'<span class="codicon codicon-arrow-up"></span> Update';
					btn.disabled = false;
				});
				// UI will be refreshed automatically via storage provider changes
				break;

			case "error":
				console.error("Extension error:", message.message);
				showLoadingState(false);
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

	// Initialize on load
	document.addEventListener("DOMContentLoaded", () => {
		console.log("DOM loaded, restoring search state");
		restoreSearchState();
	});

	// Also restore immediately if DOM is already loaded
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", restoreSearchState);
	} else {
		console.log("DOM already loaded, restoring search state immediately");
		restoreSearchState();
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

	// Add context menu functionality - UPDATED to use CSS classes
	document.addEventListener("contextmenu", (e) => {
		const item = e.target.closest(".item");
		if (item) {
			e.preventDefault();
			const itemId = item.getAttribute("data-item-id");

			// Create context menu
			const contextMenu = document.createElement("div");
			contextMenu.className = "context-menu";

			// Position the menu
			const rect = contextMenu.getBoundingClientRect();
			const x = Math.min(e.clientX, window.innerWidth - 150);
			const y = Math.min(e.clientY, window.innerHeight - 100);
			contextMenu.style.left = `${x}px`;
			contextMenu.style.top = `${y}px`;

			const menuItems = [
				{ label: "Show Details", command: "itemClicked", icon: "info" },
			];

			menuItems.forEach((menuItem) => {
				const menuOption = document.createElement("div");
				menuOption.className = "context-menu-item";

				menuOption.innerHTML = `
                    <span class="codicon codicon-${menuItem.icon}"></span>
                    ${menuItem.label}
                `;

				menuOption.addEventListener("click", () => {
					vscode.postMessage({
						command: menuItem.command,
						itemId: itemId,
					});
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

	// Add drag and drop functionality for .vsix files - UPDATED to use CSS classes
	document.addEventListener("dragover", (e) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = "copy";

		if (!document.querySelector(".drop-overlay")) {
			const overlay = document.createElement("div");
			overlay.className = "drop-overlay";
			overlay.innerHTML = `
                <div class="drop-overlay-content">
                    <div class="codicon codicon-file drop-overlay-icon"></div>
                    <div>Drop .vsix files here to install</div>
                </div>
            `;
			document.body.appendChild(overlay);
		}
	});

	document.addEventListener("dragleave", (e) => {
		if (e.clientX === 0 || e.clientY === 0) {
			const overlay = document.querySelector(".drop-overlay");
			if (overlay) {
				document.body.removeChild(overlay);
			}
		}
	});

	document.addEventListener("drop", (e) => {
		e.preventDefault();
		const overlay = document.querySelector(".drop-overlay");
		if (overlay) {
			document.body.removeChild(overlay);
		}

		const files = Array.from(e.dataTransfer.files);
		const vsixFiles = files.filter((file) =>
			file.name.toLowerCase().endsWith(".vsix")
		);

		if (vsixFiles.length > 0) {
			showToast(
				`Found ${vsixFiles.length} .vsix file${
					vsixFiles.length === 1 ? "" : "s"
				}. Install them through the file system.`,
				"info"
			);
		}
	});

	// Expose functions globally for debugging
	window.vscodeExtension = {
		filterItems,
		showToast,
		showLoadingState,
		setupItemEventListeners,
		restoreSearchState,
		currentSearchTerm: () => currentSearchTerm,
	};

	// Log when the script initializes
	console.log("Main.js initialized, setting up initial event listeners");

	// Set up initial event listeners and restore state
	setTimeout(() => {
		setupItemEventListeners();
		restoreSearchState();
		console.log("Initial setup complete");
	}, 100);
})();
