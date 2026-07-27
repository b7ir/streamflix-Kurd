class NetflixIPTVPlayer {
    constructor() {
        this.channels = [];
        this.filteredChannels = [];
        this.currentChannelIndex = -1;
        this.isPlaying = false;
        this.isMuted = false;
        this.currentHls = null; // Current HLS.js instance
        this.channelLoadToken = 0;
        this.channelStartedAt = null;
        this.programTicker = null;
        this.currentSidebarChannel = null;
        this.sidebarChannelsView = [];
        this.sidebarVisibleCount = 0;
        this.sidebarPageSize = 0;
        this.sidebarChunkSize = 10;
        this.sidebarSearchTerm = '';
        this.pendingRequestedChannel = null;
        this.isNowPlayingCollapsed = false;
        this.controlsHideTimer = null;
        this.controlsHideDelay = 5000;
        this.maxNetworkRetries = 1;
        this.channelStatusCacheKey = 'streamflix-channel-status-v1';
        this.channelStatusTtlMs = 10 * 60 * 1000;
        this.channelStatusCache = this.loadChannelStatusCache();
        this.statusProbeQueue = [];
        this.statusProbeInFlight = new Set();
        this.statusProbeWorkers = 0;
        this.maxStatusProbeWorkers = 3;
        this.relayEnabled = false;
        this.relayEndpoint = this.resolveRelayEndpoint();
        this.relayHealthEndpoint = this.resolveRelayHealthEndpoint(this.relayEndpoint);
        this.defaultPlaylistType = this.resolveDefaultPlaylistType();
        this.activePlaylistType = this.defaultPlaylistType;
        this.playlists = {
            kurdish: 'https://kurdtvs.net/iptv.php?format=m3u',
            kurd2: 'https://iptv-org.github.io/iptv/languages/kur.m3u'
        };
        
        this.initializeElements();
        
        // Only proceed with initialization if we have the essential elements
        if (this.videoPlayer) {
            this.bindEvents();
            this.initializeSplashScreen();
            this.initializeMobileFeatures();
            this.setupOverlayVisibilityControls();
            this.detectRelaySupport();
            this.loadPlaylist(this.defaultPlaylistType);
            this.setupUIEffects();
            this.setupPlayerSidebar(); // Setup sidebar functionality
            
            // Check for channel parameter in URL
            this.checkUrlParameters();
        } else {
            console.log('⚠️ Essential player elements not found - skipping player initialization');
        }
    }

    checkUrlParameters() {
        const urlParams = new URLSearchParams(window.location.search);
        const channelId = urlParams.get('channel');
        const streamUrl = urlParams.get('stream');
        const channelName = urlParams.get('name');
        const channelGroup = urlParams.get('group');
        const channelLogo = urlParams.get('logo');
        const requestedPlaylist = urlParams.get('playlist');

        if (requestedPlaylist && this.playlists[requestedPlaylist]) {
            this.defaultPlaylistType = requestedPlaylist;
            this.activePlaylistType = requestedPlaylist;
            localStorage.setItem('streamflix-preferred-playlist', requestedPlaylist);
            if (this.playlistSelect) {
                this.playlistSelect.value = requestedPlaylist;
            }
        }

        if (channelId || streamUrl || channelName) {
            this.pendingRequestedChannel = {
                channelId,
                streamUrl,
                name: channelName,
                group: channelGroup,
                logo: channelLogo
            };
            console.log('🎯 Channel request found in URL params:', this.pendingRequestedChannel);
            this.applyPendingRequestedChannel();
        } else {
            console.log('ℹ️ No channel parameter in URL');
        }
    }

    applyPendingRequestedChannel() {
        if (!this.pendingRequestedChannel || this.channels.length === 0) return;

        const { channelId, streamUrl, name } = this.pendingRequestedChannel;
        let targetIndex = -1;

        if (streamUrl) {
            targetIndex = this.channels.findIndex((c) => c.url === streamUrl);
        }
        if (targetIndex === -1 && channelId !== null && channelId !== undefined) {
            targetIndex = this.channels.findIndex((c) => String(c.id) === String(channelId));
        }
        if (targetIndex === -1 && name) {
            const wanted = name.toLowerCase();
            targetIndex = this.channels.findIndex((c) => c.name.toLowerCase() === wanted);
        }

        if (targetIndex !== -1) {
            console.log(`🎬 Playing requested channel: ${this.channels[targetIndex].name}`);
            this.currentChannelIndex = targetIndex;
            this.selectChannel(targetIndex);
            this.renderPlayerChannelList(this.filteredChannels);
            this.pendingRequestedChannel = null;
            return;
        }

        // Fallback: play the explicit stream URL even if it doesn't map to parsed list.
        if (streamUrl) {
            const fallbackChannel = {
                name: name || 'Requested Channel',
                group: this.pendingRequestedChannel.group || 'Live',
                logo: this.pendingRequestedChannel.logo || '',
                resolution: 'LIVE',
                url: streamUrl
            };
            console.log('⚠️ Requested channel not found in parsed list, using direct stream fallback');
            this.currentChannelIndex = -1;
            this.updateChannelInfo(fallbackChannel);
            this.updateSidebarInfo(fallbackChannel);
            this.updateProgramPanel(fallbackChannel);
            this.loadChannel(streamUrl, fallbackChannel);
            this.pendingRequestedChannel = null;
        }
    }

    initializeSplashScreen() {
        // Hide splash screen after animation completes
        setTimeout(() => {
            const splash = document.getElementById('splash-screen');
            if (splash) {
                splash.style.display = 'none';
            }
        }, 3000); // 2.5s animation + 0.5s buffer
    }

    initializeElements() {
        // Video elements
        this.videoPlayer = document.getElementById('video-player');
        this.videoWrapper = document.querySelector('.video-wrapper');
        this.channelInfo = document.getElementById('channel-info');
        this.currentChannelName = document.getElementById('current-channel-name');
        this.currentChannelGroup = document.getElementById('current-channel-group');
        this.channelResolution = document.getElementById('channel-resolution');
        this.channelCategory = document.getElementById('channel-category');
        this.loadingOverlay = document.getElementById('loading');
        this.progressBar = document.getElementById('progress-fill');

        // Control elements
        this.playPauseBtn = document.getElementById('play-pause');
        this.prevChannelBtn = document.getElementById('prev-channel');
        this.nextChannelBtn = document.getElementById('next-channel');
        this.volumeSlider = document.getElementById('volume-slider');
        this.muteToggleBtn = document.getElementById('mute-toggle');
        this.toggleSidebarBtn = document.getElementById('toggle-sidebar');
        this.closeSidebarBtn = document.getElementById('close-sidebar');
        this.fullscreenBtn = document.getElementById('fullscreen-toggle');
        this.pipBtn = document.getElementById('pip-toggle');
        this.theaterBtn = document.getElementById('theater-mode');

        // Sidebar elements
        this.sidebar = document.getElementById('sidebar');
        this.sidebarSearch = document.getElementById('sidebar-search');
        this.playerChannelList = document.getElementById('player-channel-list');
        this.channelCount = document.getElementById('channel-count');
        this.sidebarLoadMoreBtn = document.getElementById('sidebar-load-more');
        this.nowPlayingSection = document.querySelector('.now-playing');
        this.toggleNowPlayingBtn = document.getElementById('toggle-now-playing');
        this.playlistSelect = document.getElementById('playlist-select');
        this.searchInput = document.getElementById('search-input');
        this.categoryFilter = document.getElementById('category-filter');
        this.channelList = document.getElementById('channel-list'); // Homepage only
        this.sidebarChannelLogo = document.getElementById('sidebar-channel-logo');
        this.sidebarChannelName = document.getElementById('sidebar-channel-name');
        this.sidebarChannelInfo = document.getElementById('sidebar-channel-info');
        this.programCurrentEl = document.getElementById('program-current');
        this.programSlotEl = document.getElementById('program-slot');
        this.programNextEl = document.getElementById('program-next');
        this.programRemainingEl = document.getElementById('program-remaining');
        this.programProgressFillEl = document.getElementById('program-progress-fill');
        this.sessionDurationEl = document.getElementById('session-duration');
        this.streamFormatEl = document.getElementById('stream-format');
        this.streamSourceEl = document.getElementById('stream-source');
        this.playUrlBtn = document.getElementById('play-url-btn');

        // YouTube player container
        this.youtubeContainer = document.createElement('div');
        this.youtubeContainer.id = 'youtube-player-container';
        this.youtubeContainer.style.display = 'none';
        this.youtubeContainer.style.width = '100%';
        this.youtubeContainer.style.height = '100%';
        this.youtubeContainer.style.position = 'absolute';
        this.youtubeContainer.style.top = '0';
        this.youtubeContainer.style.left = '0';
        this.youtubeContainer.style.zIndex = '1';
        
        if (this.videoWrapper) {
            this.videoWrapper.insertBefore(this.youtubeContainer, this.videoPlayer);
        }

        // Debug logging
        console.log('🔍 Element initialization results:');
        console.log('- Video player:', !!this.videoPlayer);
        console.log('- Sidebar:', !!this.sidebar);
        console.log('- Toggle sidebar btn:', !!this.toggleSidebarBtn);
        console.log('- Close sidebar btn:', !!this.closeSidebarBtn);
        console.log('- Sidebar search:', !!this.sidebarSearch);
        console.log('- Player channel list:', !!this.playerChannelList);

        // Set initial volume only if video player exists
        if (this.videoPlayer) {
            this.videoPlayer.volume = 0.8;
            this.lastVolume = 0.8;
            if (this.videoWrapper) {
                this.videoWrapper.classList.add('is-paused');
            }
        }
        
        if (this.volumeSlider) {
            this.volumeSlider.value = 80;
        }
        
        this.isMuted = false;
        this.isTheaterMode = false;
        
        console.log('Player elements initialized');
    }

    bindEvents() {
        // Video player events
        if (this.videoPlayer) {
            this.videoPlayer.addEventListener('play', () => this.onPlay());
            this.videoPlayer.addEventListener('pause', () => this.onPause());
            this.videoPlayer.addEventListener('error', (e) => this.onError(e));
            this.videoPlayer.addEventListener('loadstart', () => this.onLoadStart());
            this.videoPlayer.addEventListener('canplay', () => this.onCanPlay());
            this.videoPlayer.addEventListener('timeupdate', () => this.updateProgress());
        }

        // Control button events - only bind if elements exist
        if (this.playPauseBtn) {
            this.playPauseBtn.addEventListener('click', () => this.togglePlayPause());
        }
        if (this.prevChannelBtn) {
            this.prevChannelBtn.addEventListener('click', () => this.previousChannel());
        }
        if (this.nextChannelBtn) {
            this.nextChannelBtn.addEventListener('click', () => this.nextChannel());
        }
        if (this.volumeSlider) {
            this.volumeSlider.addEventListener('input', (e) => this.setVolume(e.target.value));
        }
        if (this.muteToggleBtn) {
            this.muteToggleBtn.addEventListener('click', () => this.toggleMute());
        }
        if (this.fullscreenBtn) {
            this.fullscreenBtn.addEventListener('click', () => this.toggleFullscreen());
        }
        if (this.pipBtn) {
            this.pipBtn.addEventListener('click', () => this.togglePiP());
        }
        if (this.theaterBtn) {
            this.theaterBtn.addEventListener('click', () => this.toggleTheaterMode());
        }

        // Sidebar events
        if (this.toggleSidebarBtn) {
            this.toggleSidebarBtn.addEventListener('click', () => this.toggleSidebar());
        }
        if (this.closeSidebarBtn) {
            this.closeSidebarBtn.addEventListener('click', () => this.toggleSidebar());
        }
        if (this.toggleNowPlayingBtn) {
            this.toggleNowPlayingBtn.addEventListener('click', () => this.toggleNowPlaying());
        }
        if (this.playlistSelect) {
            this.playlistSelect.addEventListener('change', (e) => this.onPlaylistChange(e.target.value));
        }
        if (this.searchInput) {
            this.searchInput.addEventListener('input', (e) => this.filterChannels(e.target.value));
        }
        if (this.categoryFilter) {
            this.categoryFilter.addEventListener('change', (e) => this.filterByCategory(e.target.value));
        }

        if (this.playUrlBtn) {
            this.playUrlBtn.addEventListener('click', () => this.promptForCustomUrl());
        }

        if (this.videoWrapper) {
            this.videoWrapper.addEventListener('mousemove', () => this.setControlsOverlayVisible(true, true));
            this.videoWrapper.addEventListener('touchstart', () => this.setControlsOverlayVisible(true, true), { passive: true });
            this.videoWrapper.addEventListener('click', (e) => {
                const interactiveTarget = e.target.closest('button, input, .sidebar, a, select');
                if (interactiveTarget) return;
                if (e.target === this.videoPlayer) {
                    this.toggleControlsOverlay();
                } else {
                    this.setControlsOverlayVisible(true, true);
                }
            });
        }

        // Window events
        window.addEventListener('scroll', () => this.handleScroll());
        document.addEventListener('keydown', (e) => this.handleKeyboard(e));

        // Fullscreen change events
        document.addEventListener('fullscreenchange', () => this.onFullscreenChange());
        document.addEventListener('webkitfullscreenchange', () => this.onFullscreenChange());
        document.addEventListener('mozfullscreenchange', () => this.onFullscreenChange());

        // Navbar scroll effect
        window.addEventListener('scroll', () => {
            const navbar = document.querySelector('.navbar') || document.querySelector('.player-navbar');
            if (navbar && window.scrollY > 50) {
                navbar.classList.add('scrolled');
            } else if (navbar) {
                navbar.classList.remove('scrolled');
            }
        });
    }

    setupUIEffects() {
        // Intentionally handled via CSS only to keep runtime lightweight.
    }

    setupOverlayVisibilityControls() {
        this.setControlsOverlayVisible(true, true);
    }

    toggleControlsOverlay() {
        if (!this.videoWrapper) return;
        const isVisible = this.videoWrapper.classList.contains('show-controls');
        this.setControlsOverlayVisible(!isVisible, !isVisible);
    }

    setControlsOverlayVisible(visible, autoHide = false) {
        if (!this.videoWrapper) return;
        this.videoWrapper.classList.toggle('show-controls', visible);

        if (this.controlsHideTimer) {
            clearTimeout(this.controlsHideTimer);
            this.controlsHideTimer = null;
        }

        if (visible && autoHide) {
            this.controlsHideTimer = setTimeout(() => {
                if (this.videoWrapper) {
                    this.videoWrapper.classList.remove('show-controls');
                }
                this.controlsHideTimer = null;
            }, this.controlsHideDelay);
        }
    }

    renderPlayerChannelList(channels = this.filteredChannels) {
        if (!this.playerChannelList) {
            console.log('ℹ️ No player channel list element found');
            return;
        }

        this.sidebarChannelsView = channels;
        const visibleChannels = channels.slice(0, this.sidebarVisibleCount || channels.length);

        console.log(`📺 Rendering ${visibleChannels.length}/${channels.length} channels to player sidebar`);
        this.playerChannelList.innerHTML = '';

        if (this.channelCount) {
            this.channelCount.textContent = channels.length;
        }

        if (channels.length === 0) {
            this.playerChannelList.innerHTML = `
                <div class="no-channels-message">
                    <i class="fas fa-search"></i>
                    <p>No channels found</p>
                </div>
            `;
            return;
        }

        visibleChannels.forEach((channel, index) => {
            const realIndex = this.channels.findIndex(c => c.id === channel.id);
            const isActive = this.currentChannelIndex === realIndex;
            const logo = channel.logo || '';
            const status = this.getChannelStatus(channel.url);
            const statusLabel = status === 'live' ? 'LIVE' : status === 'dead' ? 'DEAD' : '...';
            const statusClass = status === 'live' ? 'status-live' : status === 'dead' ? 'status-dead' : 'status-checking';
            const channelKey = encodeURIComponent(channel.url || '');
            const channelElement = document.createElement('div');
            channelElement.className = `channel-list-item ${isActive ? 'active' : ''}`;
            channelElement.dataset.channelKey = channelKey;
            channelElement.innerHTML = `
                <div class="channel-logo-small" style="background: ${this.getChannelColor(channel.group)}">
                    ${logo ? `<img src="${logo}" alt="${channel.name}" onerror="this.style.display='none'">` : 
                      `<span>${channel.name.charAt(0)}</span>`}
                </div>
                <div class="channel-info-small">
                    <h5>${channel.name}</h5>
                    <p>${channel.group}</p>
                </div>
                <span class="channel-live-badge ${statusClass}" data-channel-key="${channelKey}">${statusLabel}</span>
                ${isActive ? '<div class="play-indicator"><i class="fas fa-play"></i></div>' : ''}
            `;
            
            channelElement.addEventListener('click', () => {
                this.playSpecificChannelById(channel.id);
            });
            
            this.playerChannelList.appendChild(channelElement);
        });

        this.updateSidebarLoadMoreButton();
        this.queueVisibleChannelStatusChecks(visibleChannels);
    }

    getChannelColor(group) {
        const colors = {
            'News': '#e50914',
            'Sports': '#00bfff',
            'Entertainment': '#ff6b6b',
            'Music': '#9b59b6',
            'Kids': '#2ecc71',
            'Movies': '#f39c12'
        };
        return colors[group] || '#6c757d';
    }

    playSpecificChannel(index) {
        const channel = this.filteredChannels[index];
        if (!channel) return;

        const realIndex = this.channels.findIndex((c) => c.id === channel.id);
        if (realIndex >= 0) {
            this.currentChannelIndex = realIndex;
            this.selectChannel(realIndex);
            this.renderPlayerChannelList(this.filteredChannels);
        }
    }

    playSpecificChannelById(channelId) {
        const realIndex = this.channels.findIndex((c) => c.id === channelId);
        if (realIndex === -1) return;
        this.currentChannelIndex = realIndex;
        this.selectChannel(realIndex);
        this.renderPlayerChannelList(this.filteredChannels);
    }

    setupPlayerSidebar() {
        // Bind sidebar search
        if (this.sidebarSearch) {
            this.sidebarSearch.addEventListener('input', (e) => {
                this.filterPlayerChannels(e.target.value);
            });
        }

        if (this.sidebarLoadMoreBtn) {
            this.sidebarLoadMoreBtn.addEventListener('click', () => this.loadMoreSidebarChannels());
        }
        
        // Render initial channel list
        this.resetSidebarPagination(this.filteredChannels);
    }

    filterPlayerChannels(searchTerm) {
        this.sidebarSearchTerm = (searchTerm || '').trim().toLowerCase();
        const filtered = this.channels.filter(channel =>
            channel.name.toLowerCase().includes(this.sidebarSearchTerm) ||
            channel.group.toLowerCase().includes(this.sidebarSearchTerm)
        );
        this.filteredChannels = filtered;
        this.resetSidebarPagination(filtered);

        if (this.playerChannelList) {
            this.playerChannelList.scrollTop = 0;
        }
    }

    resetSidebarPagination(channels) {
        this.sidebarChannelsView = channels;
        this.sidebarPageSize = channels.length > 0 ? this.sidebarChunkSize : 0;
        this.sidebarVisibleCount = Math.min(this.sidebarPageSize, channels.length);
        this.renderPlayerChannelList(channels);
    }

    loadMoreSidebarChannels() {
        if (this.sidebarVisibleCount >= this.sidebarChannelsView.length) return;
        this.sidebarVisibleCount = Math.min(
            this.sidebarVisibleCount + this.sidebarPageSize,
            this.sidebarChannelsView.length
        );
        this.renderPlayerChannelList(this.sidebarChannelsView);
    }

    updateSidebarLoadMoreButton() {
        if (!this.sidebarLoadMoreBtn) return;
        const hasMore = this.sidebarVisibleCount < this.sidebarChannelsView.length;
        this.sidebarLoadMoreBtn.style.display = hasMore ? 'inline-flex' : 'none';
    }

    toggleNowPlaying(forceCollapsed = null) {
        if (!this.nowPlayingSection || !this.toggleNowPlayingBtn) return;

        const collapsed = typeof forceCollapsed === 'boolean'
            ? forceCollapsed
            : !this.nowPlayingSection.classList.contains('collapsed');
        this.isNowPlayingCollapsed = collapsed;
        this.nowPlayingSection.classList.toggle('collapsed', collapsed);

        const icon = this.toggleNowPlayingBtn.querySelector('i');
        if (icon) {
            icon.className = collapsed ? 'fas fa-chevron-down' : 'fas fa-chevron-up';
        }
        this.toggleNowPlayingBtn.title = collapsed ? 'Show now playing details' : 'Hide now playing details';
    }

    async loadPlaylist(type) {
        try {
            const selectedType = this.playlists[type] ? type : 'kurdish';
            this.activePlaylistType = selectedType;
            localStorage.setItem('streamflix-preferred-playlist', selectedType);
            if (this.playlistSelect) {
                this.playlistSelect.value = selectedType;
            }
            console.log(`📡 Loading ${selectedType} playlist...`);
            this.showLoading(true);
            
            const url = this.playlists[selectedType];
            console.log(`🔗 Fetching from: ${url}`);
            
            const response = await fetch(url);
            console.log(`✅ Response status: ${response.status}`);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            
            const playlistText = await response.text();
            console.log(`📄 Received ${playlistText.length} bytes`);
            
            this.parsePlaylist(playlistText);
            console.log(`🎯 Parsed ${this.channels.length} channels`);
            const searchTerm = this.sidebarSearch ? this.sidebarSearch.value : this.sidebarSearchTerm;
            this.filterPlayerChannels(searchTerm || '');
            this.applyPendingRequestedChannel();
            
            // Homepage-only UI hooks are guarded internally for player page.
            this.renderChannelGrid();
            this.populateCategories();
            this.showLoading(false);
            
            console.log(`✅ Playlist loaded successfully!`);
        } catch (error) {
            console.error('❌ Error loading playlist:', error);
            this.showLoading(false);
            this.showError(`Failed to load playlist: ${error.message}`);
        }
    }

    onPlaylistChange(type) {
        if (this.sidebarSearch) {
            this.sidebarSearch.value = '';
        }
        this.sidebarSearchTerm = '';
        this.loadPlaylist(type);
    }

    resolveDefaultPlaylistType() {
        const urlParams = new URLSearchParams(window.location.search);
        const fromUrl = urlParams.get('playlist');
        if (fromUrl && ['kurdish', 'kurd2'].includes(fromUrl)) {
            return fromUrl;
        }
        const stored = localStorage.getItem('streamflix-preferred-playlist');
        if (stored && ['kurdish', 'kurd2'].includes(stored)) {
            return stored;
        }
        return 'kurdish';
    }

    parsePlaylist(playlistText) {
        console.log('🔍 Parsing M3U playlist...');
        const lines = playlistText.split('\n');
        this.channels = [];
        let currentChannel = null;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            if (line.startsWith('#EXTINF:')) {
                const metadata = this.parseChannelMetadata(line);
                currentChannel = {
                    ...metadata,
                    url: '',
                    id: this.channels.length // Unique ID for indexing
                };
            } else if (line.startsWith('http') && currentChannel) {
                currentChannel.url = line;
                // Validate that this is actually a stream URL
                if (this.isValidStreamUrl(line)) {
                    this.channels.push(currentChannel);
                }
                currentChannel = null;
            }
        }
        
        this.filteredChannels = [...this.channels];
        console.log(`✅ Parsed ${this.channels.length} valid channels`);
        
        if (this.channels.length === 0) {
            console.warn('⚠️ No channels found in playlist!');
            this.showError('No channels found in playlist');
        }
    }

    isValidStreamUrl(url) {
        // Basic validation for stream URLs
        const validExtensions = ['.m3u8', '.mp4', '.ts', '.webm'];
        return validExtensions.some(ext => url.includes(ext)) || 
               url.includes('live') || 
               url.includes('stream') ||
               this.isYoutubeUrl(url);
    }

    isYoutubeUrl(url) {
        return url.includes('youtube.com') || url.includes('youtu.be');
    }

    extractYoutubeId(url) {
        const regExp = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
        const match = url.match(regExp);
        return (match && match[2].length === 11) ? match[2] : null;
    }

    parseChannelMetadata(line) {
        const metadataMatch = line.match(/#EXTINF:-1\s*(.*?)\s*,(.*)/);
        if (!metadataMatch) return { name: 'Unknown Channel', group: 'General' };

        const attributes = metadataMatch[1];
        const name = metadataMatch[2].trim();

        const tvgId = this.getAttribute(attributes, 'tvg-id');
        const tvgLogo = this.getAttribute(attributes, 'tvg-logo');
        const groupTitle = this.getAttribute(attributes, 'group-title') || 'General';
        const resolution = this.extractResolution(name);

        return {
            name: name.replace(/\s*\(\d+p\)$/, ''),
            group: groupTitle,
            logo: tvgLogo || '',
            tvgId: tvgId || '',
            resolution: resolution,
            originalName: name
        };
    }

    getAttribute(text, attrName) {
        const match = text.match(new RegExp(`${attrName}="(.*?)"`));
        return match ? match[1] : '';
    }

    extractResolution(name) {
        const match = name.match(/\((\d+)p\)$/);
        return match ? match[1] + 'p' : 'SD';
    }

    renderChannelGrid(channels = this.filteredChannels) {
        console.log(`🎨 Rendering ${channels.length} channels to grid`);
        
        // Only render if channel list element exists (homepage only)
        if (!this.channelList) {
            console.log('ℹ️ No channel list element found - skipping grid render');
            return;
        }
        
        this.channelList.innerHTML = '';

        if (channels.length === 0) {
            this.channelList.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 3rem; color: #808080;">
                    <i class="fas fa-search" style="font-size: 3rem; margin-bottom: 1rem;"></i>
                    <h3>No channels found</h3>
                    <p>Try adjusting your search or filter criteria</p>
                </div>
            `;
            console.warn('⚠️ No channels to render');
            return;
        }

        channels.forEach((channel, index) => {
            const channelElement = this.createChannelCard(channel, index);
            this.channelList.appendChild(channelElement);
        });
        this.queueVisibleChannelStatusChecks(channels);
        
        console.log(`✅ Successfully rendered ${channels.length} channel cards`);
    }

    createChannelCard(channel, displayIndex) {
        const card = document.createElement('div');
        card.className = 'channel-card';
        card.dataset.channelId = channel.id;
        card.dataset.realIndex = this.channels.findIndex(c => c.id === channel.id);
        const fallbackInitial = channel.name ? channel.name.charAt(0).toUpperCase() : 'TV';
        const status = this.getChannelStatus(channel.url);
        const statusLabel = status === 'live' ? 'LIVE' : status === 'dead' ? 'DEAD' : '...';
        const statusClass = status === 'live' ? 'status-live' : status === 'dead' ? 'status-dead' : 'status-checking';
        const channelKey = encodeURIComponent(channel.url || '');
        card.dataset.channelKey = channelKey;

        card.innerHTML = `
            <div class="channel-thumbnail">
                <div class="channel-placeholder" style="background: ${this.getChannelColor(channel.group)}">
                    <i class="fas fa-tv"></i>
                    <span>${fallbackInitial}</span>
                </div>
                ${channel.logo
                    ? `<img class="channel-thumb-img" src="${channel.logo}" alt="${channel.name} logo" onerror="this.style.display='none'">`
                    : ''}
                <span class="channel-live-badge ${statusClass}" data-channel-key="${channelKey}">${statusLabel}</span>
            </div>
            <div class="channel-info">
                <div class="channel-name">${channel.name}</div>
                <div class="channel-meta-info">
                    <span class="channel-group">${channel.group}</span>
                    <span class="channel-resolution-tag">${channel.resolution}</span>
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            const realIndex = parseInt(card.dataset.realIndex);
            this.selectChannel(realIndex);
        });

        return card;
    }

    populateCategories() {
        if (!this.categoryFilter) {
            console.log('ℹ️ No category filter element found - skipping category population');
            return;
        }

        const categories = [...new Set(this.channels.map(channel => channel.group))];
        this.categoryFilter.innerHTML = '<option value="all">All Categories</option>';
        
        categories.sort().forEach(category => {
            const option = document.createElement('option');
            option.value = category;
            option.textContent = category;
            this.categoryFilter.appendChild(option);
        });
    }

    selectChannel(realIndex) {
        if (realIndex < 0 || realIndex >= this.channels.length) {
            console.warn('Invalid channel index:', realIndex);
            return;
        }

        const channel = this.channels[realIndex];
        console.log('Selecting channel:', channel.name, 'URL:', channel.url);

        // Update UI state
        this.updateActiveChannel(realIndex);
        this.updateChannelInfo(channel);
        this.updateSidebarInfo(channel);
        this.updateProgramPanel(channel);
        
        // Load and play the channel
        this.currentChannelIndex = realIndex;
        this.loadChannel(channel.url, channel);
    }

    updateActiveChannel(realIndex) {
        // Remove active state from all cards
        document.querySelectorAll('.channel-card').forEach(card => {
            card.classList.remove('active');
        });
        
        // Find and activate the correct card
        const activeCard = document.querySelector(`.channel-card[data-real-index="${realIndex}"]`);
        if (activeCard) {
            activeCard.classList.add('active');
            // Scroll to the active card
            activeCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
    }

    updateChannelInfo(channel) {
        this.currentChannelName.textContent = channel.name;
        this.currentChannelGroup.textContent = channel.group;
        this.channelResolution.textContent = channel.resolution;
        this.channelCategory.textContent = 'LIVE';
    }

    updateSidebarInfo(channel) {
        this.sidebarChannelName.textContent = channel.name;
        this.sidebarChannelInfo.textContent = `${channel.group} • ${channel.resolution}`;
        
        if (channel.logo) {
            this.sidebarChannelLogo.src = channel.logo;
            this.sidebarChannelLogo.style.display = 'block';
            this.sidebarChannelLogo.onerror = () => {
                this.sidebarChannelLogo.style.display = 'none';
            };
        } else {
            this.sidebarChannelLogo.style.display = 'none';
        }
    }

    updateProgramPanel(channel) {
        this.currentSidebarChannel = channel;
        this.channelStartedAt = Date.now();
        this.renderProgramPanel();

        if (this.programTicker) {
            clearInterval(this.programTicker);
        }
        this.programTicker = setInterval(() => this.renderProgramPanel(), 1000);
    }

    renderProgramPanel() {
        if (!this.currentSidebarChannel) return;

        const channel = this.currentSidebarChannel;
        const now = new Date();
        const slotStart = new Date(now);
        slotStart.setMinutes(0, 0, 0);
        const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);
        const elapsed = now.getTime() - slotStart.getTime();
        const progress = Math.max(0, Math.min(100, (elapsed / (60 * 60 * 1000)) * 100));
        const remainingMin = Math.max(0, Math.ceil((slotEnd.getTime() - now.getTime()) / 60000));

        const currentProgram = this.getEstimatedProgramTitle(channel, 0);
        const nextProgram = this.getEstimatedProgramTitle(channel, 1);
        const sessionMs = this.channelStartedAt ? Date.now() - this.channelStartedAt : 0;

        if (this.programCurrentEl) this.programCurrentEl.textContent = currentProgram;
        if (this.programSlotEl) this.programSlotEl.textContent = `${this.formatTime(slotStart)} - ${this.formatTime(slotEnd)}`;
        if (this.programNextEl) this.programNextEl.textContent = nextProgram;
        if (this.programRemainingEl) this.programRemainingEl.textContent = `Remaining: ${remainingMin}m`;
        if (this.programProgressFillEl) this.programProgressFillEl.style.width = `${progress}%`;
        if (this.sessionDurationEl) this.sessionDurationEl.textContent = this.formatDuration(sessionMs);
        if (this.streamFormatEl) this.streamFormatEl.textContent = this.getStreamFormat(channel.url);
        if (this.streamSourceEl) this.streamSourceEl.textContent = this.getSourceHost(channel.url);
    }

    getEstimatedProgramTitle(channel, offset = 0) {
        const group = (channel.group || 'General').trim();
        const presets = {
            News: ['Live Bulletin', 'Prime Debate', 'Top Headlines', 'Breaking Desk'],
            Sports: ['Live Match Center', 'Sports Roundup', 'Highlights Show', 'Post Match Analysis'],
            Entertainment: ['Drama Hour', 'Star Showcase', 'Evening Special', 'Prime Entertainment'],
            Music: ['Music Mix Live', 'Top Charts', 'Retro Beats', 'Live Requests'],
            Movies: ['Movie Showcase', 'Cinema Express', 'Blockbuster Hour', 'Late Night Cinema'],
            Kids: ['Kids Fun Time', 'Cartoon Express', 'Family Hour', 'Adventure Time']
        };
        const pool = presets[group] || ['Live Broadcast', 'Special Program', 'Prime Slot', 'Featured Stream'];
        const hash = (channel.name || '').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
        const index = (new Date().getHours() + hash + offset) % pool.length;
        return pool[index];
    }

    formatTime(dateObj) {
        return dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    formatDuration(ms) {
        const total = Math.max(0, Math.floor(ms / 1000));
        const h = String(Math.floor(total / 3600)).padStart(2, '0');
        const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
        const s = String(total % 60).padStart(2, '0');
        return `${h}:${m}:${s}`;
    }

    getStreamFormat(url = '') {
        if (this.isYoutubeUrl(url)) return 'YouTube Live';
        const clean = url.split('?')[0].toLowerCase();
        if (clean.includes('.m3u8')) return 'HLS (.m3u8)';
        if (clean.includes('.mp4')) return 'MP4';
        if (clean.includes('.ts')) return 'MPEG-TS';
        if (clean.includes('.webm')) return 'WebM';
        return 'Live Stream';
    }

    getSourceHost(url = '') {
        try {
            return new URL(url).hostname || '--';
        } catch (error) {
            return '--';
        }
    }

    loadChannel(url, channel = null, options = {}) {
        console.log('Loading channel:', url);
        this.showLoading(true);

        // Handle YouTube channels
        if (this.isYoutubeUrl(url)) {
            this.loadYoutubeChannel(url);
            return;
        }

        // Hide YouTube container if visible
        if (this.youtubeContainer) {
            this.youtubeContainer.style.display = 'none';
            this.youtubeContainer.innerHTML = '';
        }
        this.videoPlayer.style.display = 'block';

        const {
            allowHttpUpgrade = true,
            forceDirect = false,
            allowDirectFallback = true,
            forceRelay = false
        } = options;
        let streamUrl = url;
        const relayRequired = this.requiresRelay(streamUrl);
        const canUseRelay = this.relayEnabled;
        let usingRelay = this.shouldRelayUrl(streamUrl, forceDirect, forceRelay);

        if (relayRequired && !usingRelay) {
            this.showLoading(false);
            this.showError('Relay is required for this channel on HTTPS. Relay is unavailable right now.');
            return;
        }

        if (this.isMixedContentUrl(streamUrl)) {
            if (this.relayEnabled) {
                usingRelay = true;
            } else if (allowHttpUpgrade) {
                const upgradedUrl = this.upgradeToHttps(streamUrl);
                console.warn('HTTP stream on HTTPS page. Trying HTTPS fallback:', upgradedUrl);
                streamUrl = upgradedUrl;
            } else {
                this.showLoading(false);
                this.showError('This channel uses HTTP and is blocked on HTTPS. Try a secure (HTTPS) stream.');
                return;
            }
        }

        const relayTarget = usingRelay ? url : null;
        const playbackUrl = usingRelay ? this.buildRelayUrl(streamUrl) : streamUrl;

        if (usingRelay) {
            console.log('Using StreamFlix relay for playback');
        }
        
        const video = this.videoPlayer;
        const loadToken = ++this.channelLoadToken;
        let networkRetries = 0;

        video.pause();
        
        if (this.currentHls) {
            this.currentHls.destroy();
            this.currentHls = null;
        }
        
        if (Hls.isSupported()) {
            console.log('Using HLS.js');
            const hls = new Hls({
                enableWorker: true,
                lowLatencyMode: false,
                backBufferLength: 90
            });
            
            hls.loadSource(playbackUrl);
            hls.attachMedia(video);
            
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
                if (loadToken !== this.channelLoadToken || hls !== this.currentHls) return;
                console.log('HLS Manifest parsed, playing...');
                const playPromise = video.play();
                if (!playPromise || typeof playPromise.then !== 'function') {
                    this.showLoading(false);
                    return;
                }
                playPromise
                    .then(() => {
                        if (loadToken !== this.channelLoadToken) return;
                        console.log('Playing successfully');
                        this.showLoading(false);
                    })
                    .catch(error => {
                        if (loadToken !== this.channelLoadToken) return;
                        if (error && error.name === 'AbortError') {
                            console.log('Play request superseded by a newer channel load');
                            return;
                        }
                        console.log('Autoplay blocked:', error);
                        this.showLoading(false);
                    });
            });
            
            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.error('Fatal HLS error:', data);
                    const classifiedError = this.classifyPlaybackError(data, streamUrl, channel);
                    switch (data.type) {
                        case Hls.ErrorTypes.NETWORK_ERROR:
                            if (usingRelay && relayTarget && allowDirectFallback && !relayRequired && this.shouldFallbackToDirect(data)) {
                                console.warn('Relay failed, trying direct stream fallback once');
                                this.loadChannel(relayTarget, channel, {
                                    allowHttpUpgrade: false,
                                    forceDirect: true,
                                    allowDirectFallback: false
                                });
                                return;
                            }
                            
                            if (!usingRelay && this.relayEnabled && !forceDirect) {
                                console.warn('Direct connection failed, attempting fallback to relay...');
                                this.loadChannel(url, channel, {
                                    allowHttpUpgrade: false,
                                    forceDirect: false,
                                    allowDirectFallback: false,
                                    forceRelay: true
                                });
                                return;
                            }

                            if (usingRelay && !allowDirectFallback && allowHttpUpgrade && this.isHttpStreamUrl(streamUrl)) {
                                const upgradedUrl = this.upgradeToHttps(streamUrl);
                                console.warn('Relay failed, attempting direct HTTPS upgrade fallback:', upgradedUrl);
                                this.loadChannel(upgradedUrl, channel, {
                                    allowHttpUpgrade: false,
                                    forceDirect: true,
                                    allowDirectFallback: false,
                                    forceRelay: false
                                });
                                return;
                            }

                            if (usingRelay && !allowDirectFallback && !forceDirect && (data.response.code === 403 || data.response.code === 401)) {
                                console.warn('Relay blocked (403/401), attempting direct connection as last resort...');
                                this.loadChannel(streamUrl, channel, {
                                    allowHttpUpgrade: false,
                                    forceDirect: true,
                                    allowDirectFallback: false,
                                    forceRelay: false
                                });
                                return;
                            }

                            if (classifiedError.blockRetry) {
                                this.showLoading(false);
                                this.showError(classifiedError.message);
                                break;
                            }
                            if (networkRetries < this.maxNetworkRetries) {
                                networkRetries += 1;
                                console.log(`Network error, retrying... (${networkRetries}/${this.maxNetworkRetries})`);
                                hls.startLoad();
                            } else {
                                this.showLoading(false);
                                this.showError(classifiedError.message);
                            }
                            break;
                        case Hls.ErrorTypes.MEDIA_ERROR:
                            console.log('Media error, recovering...');
                            hls.recoverMediaError();
                            break;
                        default:
                            this.showLoading(false);
                            this.showError(classifiedError.message);
                            break;
                    }
                }
            });
            
            this.currentHls = hls;
            
        } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            console.log('Using native HLS support');
            video.src = playbackUrl;
            video.addEventListener('loadedmetadata', () => {
                if (loadToken !== this.channelLoadToken) return;
                const playPromise = video.play();
                if (!playPromise || typeof playPromise.then !== 'function') {
                    this.showLoading(false);
                    return;
                }
                playPromise
                    .then(() => {
                        if (loadToken !== this.channelLoadToken) return;
                        console.log('Playing with native HLS');
                        this.showLoading(false);
                    })
                    .catch(error => {
                        if (loadToken !== this.channelLoadToken) return;
                        if (error && error.name === 'AbortError') {
                            console.log('Native play request superseded by a newer channel load');
                            return;
                        }
                        console.log('Autoplay blocked:', error);
                        this.showLoading(false);
                    });
            }, { once: true });
            
        } else {
            console.error('HLS not supported');
            this.showLoading(false);
            this.showError('HLS streams not supported in this browser');
        }
    }

    loadYoutubeChannel(url) {
        const videoId = this.extractYoutubeId(url);
        if (!videoId) {
            this.showError('Invalid YouTube URL');
            this.showLoading(false);
            return;
        }

        console.log('Loading YouTube video:', videoId);
        
        this.videoPlayer.pause();
        this.videoPlayer.style.display = 'none';
        
        if (this.youtubeContainer) {
            this.youtubeContainer.style.display = 'block';
            this.youtubeContainer.innerHTML = `
                <iframe 
                    width="100%" 
                    height="100%" 
                    src="https://www.youtube.com/embed/${videoId}?autoplay=1&controls=1&rel=0&modestbranding=1&playsinline=1" 
                    title="YouTube video player" 
                    frameborder="0" 
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" 
                    allowfullscreen
                    style="border: none;"
                ></iframe>
            `;
        }
        
        this.showLoading(false);
        this.isPlaying = true;
        
        const playIcon = this.playPauseBtn.querySelector('i');
        playIcon.className = 'fas fa-pause';
        this.setControlsOverlayVisible(true, true);
    }

    isMixedContentUrl(url) {
        return window.location.protocol === 'https:' && /^http:\/\//i.test(url || '');
    }

    upgradeToHttps(url = '') {
        return url.replace(/^http:\/\//i, 'https://');
    }

    resolveRelayEndpoint() {
        const fromWindow = typeof window !== 'undefined' ? (window.STREAMFLIX_RELAY_BASE || '').trim() : '';
        const fromMeta = (() => {
            try {
                const meta = document.querySelector('meta[name="streamflix-relay-base"]');
                return meta ? (meta.content || '').trim() : '';
            } catch (error) {
                return '';
            }
        })();
        const isPages = typeof window !== 'undefined' && /pages\.dev$/i.test(window.location.hostname);
        const cloudflareDefault = 'https://streamflix-relay.chrizmonsaji.workers.dev';
        const raw = fromWindow || fromMeta || (isPages ? cloudflareDefault : '/api/relay');
        return raw.replace(/\/+$/, '');
    }

    resolveRelayHealthEndpoint(endpoint) {
        if (endpoint === '/api/relay') {
            return '/api/relay/health';
        }
        return `${endpoint}/health`;
    }

    async detectRelaySupport() {
        try {
            const response = await fetch(this.relayHealthEndpoint, { cache: 'no-store' });
            this.relayEnabled = response.ok;
            console.log(`Relay status: ${this.relayEnabled ? 'enabled' : 'disabled'} (${this.relayEndpoint})`);
        } catch (error) {
            this.relayEnabled = false;
            console.log(`Relay status: disabled (${this.relayEndpoint})`);
        }
    }

    loadChannelStatusCache() {
        try {
            const raw = localStorage.getItem(this.channelStatusCacheKey);
            return raw ? JSON.parse(raw) : {};
        } catch (error) {
            return {};
        }
    }

    saveChannelStatusCache() {
        try {
            localStorage.setItem(this.channelStatusCacheKey, JSON.stringify(this.channelStatusCache));
        } catch (error) {
            // Ignore storage errors.
        }
    }

    getChannelStatus(url = '') {
        const entry = this.channelStatusCache[url];
        if (!entry) return 'checking';
        if ((Date.now() - entry.checkedAt) > this.channelStatusTtlMs) return 'checking';
        return entry.state === 'live' ? 'live' : 'dead';
    }

    queueVisibleChannelStatusChecks(channels = []) {
        channels.forEach((channel) => {
            if (!channel || !channel.url) return;
            const cached = this.channelStatusCache[channel.url];
            const fresh = cached && ((Date.now() - cached.checkedAt) <= this.channelStatusTtlMs);
            if (fresh || this.statusProbeInFlight.has(channel.url)) return;
            this.statusProbeInFlight.add(channel.url);
            this.statusProbeQueue.push(channel.url);
        });
        this.runChannelStatusWorkers();
    }

    runChannelStatusWorkers() {
        while (this.statusProbeWorkers < this.maxStatusProbeWorkers && this.statusProbeQueue.length > 0) {
            const url = this.statusProbeQueue.shift();
            this.statusProbeWorkers += 1;
            this.probeChannelStatus(url)
                .catch(() => this.setChannelStatus(url, 'dead'))
                .finally(() => {
                    this.statusProbeWorkers -= 1;
                    this.statusProbeInFlight.delete(url);
                    this.runChannelStatusWorkers();
                });
        }
    }

    async probeChannelStatus(url) {
        const target = this.buildProbeUrl(url);
        if (!target) {
            this.setChannelStatus(url, 'dead');
            return;
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort('timeout'), 6000);
        try {
            const response = await fetch(target, { cache: 'no-store', signal: controller.signal });
            this.setChannelStatus(url, response.ok ? 'live' : 'dead');
        } catch (error) {
            this.setChannelStatus(url, 'dead');
        } finally {
            clearTimeout(timeout);
        }
    }

    buildProbeUrl(url) {
        if (!url) return null;
        if (this.relayEnabled && this.isHttpStreamUrl(url)) {
            return this.buildRelayUrl(url);
        }
        if (window.location.protocol === 'https:' && /^http:\/\//i.test(url)) {
            return null;
        }
        return url;
    }

    setChannelStatus(url, state) {
        this.channelStatusCache[url] = {
            state,
            checkedAt: Date.now()
        };
        this.saveChannelStatusCache();
        this.updateChannelStatusBadge(url, state);
    }

    updateChannelStatusBadge(url, state) {
        const key = encodeURIComponent(url || '');
        const badges = document.querySelectorAll(`.channel-live-badge[data-channel-key="${key}"]`);
        badges.forEach((badge) => {
            badge.classList.remove('status-live', 'status-dead', 'status-checking');
            if (state === 'live') {
                badge.classList.add('status-live');
                badge.textContent = 'LIVE';
            } else if (state === 'dead') {
                badge.classList.add('status-dead');
                badge.textContent = 'DEAD';
            } else {
                badge.classList.add('status-checking');
                badge.textContent = '...';
            }
        });
    }

    isCrossOriginHttpUrl(url) {
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin !== window.location.origin;
        } catch (error) {
            return false;
        }
    }

    isHttpStreamUrl(url) {
        if (!url) return false;
        try {
            const parsed = new URL(url);
            return ['http:', 'https:'].includes(parsed.protocol);
        } catch (error) {
            return false;
        }
    }

    requiresRelay(url) {
        if (window.location.protocol !== 'https:') return false;
        return /^http:\/\//i.test(url || '');
    }

    shouldRelayUrl(url, forceDirect = false, forceRelay = false) {
        if (forceDirect) return false;
        if (!this.relayEnabled) return false;
        if (forceRelay) return true;
        if (this.isElectron() && this.isHttpStreamUrl(url)) return false;
        return this.isHttpStreamUrl(url);
    }

    buildRelayUrl(url) {
        const separator = this.relayEndpoint.includes('?') ? '&' : '?';
        return `${this.relayEndpoint}${separator}url=${encodeURIComponent(url)}`;
    }

    shouldFallbackToDirect(data) {
        const details = (data && data.details ? String(data.details) : '').toLowerCase();
        const responseCode = data && data.response ? data.response.code : null;
        return (
            details.includes('manifestloaderror') &&
            (responseCode === 404 || responseCode === 500 || responseCode === 502 || responseCode === 503 || responseCode === 504)
        );
    }

    classifyPlaybackError(data, streamUrl, channel) {
        const channelName = channel && channel.name ? channel.name : 'This channel';
        const details = (data && data.details ? String(data.details) : '').toLowerCase();
        const responseCode = data && data.response ? data.response.code : null;
        const isCrossOrigin = (() => {
            try {
                return new URL(streamUrl).origin !== window.location.origin;
            } catch (error) {
                return true;
            }
        })();

        if (this.isMixedContentUrl(streamUrl)) {
            return {
                blockRetry: true,
                message: `${channelName} is HTTP-only and blocked on HTTPS pages.`
            };
        }

        if (details.includes('manifestloaderror') && isCrossOrigin && (responseCode === 0 || responseCode === null)) {
            return {
                blockRetry: true,
                message: `${channelName} is blocked by CORS or geo restrictions in web browsers (may still work in VLC).`
            };
        }

        if (details.includes('manifestloaderror') && (responseCode === 401 || responseCode === 403)) {
            return {
                blockRetry: true,
                message: `${channelName} was denied by upstream server (401/403). This source likely blocks relay datacenter traffic.`
            };
        }

        if (details.includes('manifestloadtimeout')) {
            return {
                blockRetry: false,
                message: `${channelName} timed out while loading. Try again or choose another channel.`
            };
        }

        return {
            blockRetry: false,
            message: `${channelName} failed to load. Stream may be offline, geo-blocked, or browser-restricted.`
        };
    }

    togglePlayPause() {
        if (this.videoPlayer.paused) {
            const playPromise = this.videoPlayer.play();
            if (playPromise && typeof playPromise.catch === 'function') {
                playPromise.catch((error) => {
                    if (error && error.name === 'AbortError') {
                        console.log('Manual play interrupted by source change');
                        return;
                    }
                    console.log('Play request failed:', error);
                });
            }
        } else {
            this.videoPlayer.pause();
        }
    }

    previousChannel() {
        if (this.channels.length === 0) return;
        const newIndex = this.currentChannelIndex <= 0 ? this.channels.length - 1 : this.currentChannelIndex - 1;
        this.selectChannel(newIndex);
    }

    nextChannel() {
        if (this.channels.length === 0) return;
        const newIndex = this.currentChannelIndex >= this.channels.length - 1 ? 0 : this.currentChannelIndex + 1;
        this.selectChannel(newIndex);
    }

    setVolume(value) {
        const volume = value / 100;
        this.videoPlayer.volume = volume;
        this.lastVolume = volume;
        
        if (volume > 0) {
            this.isMuted = false;
            this.muteToggleBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
        } else {
            this.isMuted = true;
            this.muteToggleBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
        }
    }

    toggleMute() {
        if (this.isMuted) {
            this.videoPlayer.volume = this.lastVolume > 0 ? this.lastVolume : 0.8;
            this.volumeSlider.value = this.videoPlayer.volume * 100;
            this.muteToggleBtn.innerHTML = '<i class="fas fa-volume-up"></i>';
            this.isMuted = false;
        } else {
            this.lastVolume = this.videoPlayer.volume;
            this.videoPlayer.volume = 0;
            this.volumeSlider.value = 0;
            this.muteToggleBtn.innerHTML = '<i class="fas fa-volume-mute"></i>';
            this.isMuted = true;
        }
    }

    updateProgress() {
        if (this.videoPlayer.duration) {
            const percent = (this.videoPlayer.currentTime / this.videoPlayer.duration) * 100;
            this.progressBar.style.width = percent + '%';
        }
    }

    isSidebarOpen() {
        return !!(this.sidebar && this.sidebar.classList.contains('open'));
    }

    toggleSidebar(forceOpen = null) {
        if (!this.sidebar) {
            console.error('❌ Sidebar element not found');
            return;
        }

        const shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !this.isSidebarOpen();
        this.sidebar.classList.toggle('open', shouldOpen);

        if (shouldOpen && this.sidebarSearch) {
            setTimeout(() => this.sidebarSearch.focus(), 60);
        }
    }

    filterChannels(searchTerm) {
        const term = searchTerm.toLowerCase();
        this.filteredChannels = this.channels.filter(channel =>
            channel.name.toLowerCase().includes(term) ||
            channel.group.toLowerCase().includes(term)
        );
        this.renderChannelGrid(this.filteredChannels);
    }

    filterByCategory(category) {
        this.filteredChannels = category === 'all' 
            ? this.channels 
            : this.channels.filter(channel => channel.group === category);
        this.renderChannelGrid(this.filteredChannels);
    }

    handleKeyboard(event) {
        if (event.key === 'Escape' && this.isSidebarOpen()) {
            this.toggleSidebar(false);
            return;
        }

        if (event.key === 'Escape' && document.fullscreenElement) {
            document.exitFullscreen();
            return;
        }

        if (this.isSidebarOpen()) return;

        const activeEl = document.activeElement;
        const isTyping = !!activeEl && (
            ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeEl.tagName) ||
            activeEl.isContentEditable
        );
        if (isTyping) return;
        
        if ([' ', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'm'].includes(event.key)) {
            event.preventDefault();
        }

        switch(event.key) {
            case ' ':
                this.togglePlayPause();
                break;
            case 'ArrowLeft':
                this.previousChannel();
                break;
            case 'ArrowRight':
                this.nextChannel();
                break;
            case 'ArrowUp':
                this.adjustVolume(5);
                break;
            case 'ArrowDown':
                this.adjustVolume(-5);
                break;
            case 'm':
            case 'M':
                this.toggleMute();
                break;
            case 'f':
            case 'F':
                this.toggleFullscreen();
                break;
            case 'p':
            case 'P':
                this.togglePiP();
                break;
            case 't':
            case 'T':
                this.toggleTheaterMode();
                break;
        }
    }

    adjustVolume(change) {
        const currentVolume = parseInt(this.volumeSlider.value);
        const newVolume = Math.max(0, Math.min(100, currentVolume + change));
        this.volumeSlider.value = newVolume;
        this.setVolume(newVolume);
    }

    onFullscreenChange() {
        const isFullscreen = !!document.fullscreenElement;
        const fullscreenIcon = this.fullscreenBtn.querySelector('i');
        
        if (isFullscreen) {
            document.body.classList.add('fullscreen-active');
            fullscreenIcon.className = 'fas fa-compress';
            console.log('Entered fullscreen mode');
        } else {
            document.body.classList.remove('fullscreen-active');
            fullscreenIcon.className = 'fas fa-expand';
            console.log('Exited fullscreen mode');
        }
    }

    toggleFullscreen() {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(err => {
                console.log('Fullscreen error:', err);
            });
        } else {
            document.exitFullscreen();
        }
    }

    async togglePiP() {
        if (!this.videoPlayer || !document.pictureInPictureEnabled) {
            this.showError('Picture-in-Picture is not supported in this browser.');
            return;
        }

        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
                if (this.pipBtn) this.pipBtn.classList.remove('active');
            } else {
                await this.videoPlayer.requestPictureInPicture();
                if (this.pipBtn) this.pipBtn.classList.add('active');
            }
        } catch (error) {
            console.error('PiP error:', error);
            this.showError('Unable to toggle Picture-in-Picture.');
        }
    }

    toggleTheaterMode() {
        this.isTheaterMode = !this.isTheaterMode;
        document.body.classList.toggle('theater-mode', this.isTheaterMode);
        if (this.theaterBtn) {
            this.theaterBtn.classList.toggle('active', this.isTheaterMode);
        }
    }

    handleScroll() {
        const scrolled = window.pageYOffset;
        const hero = document.querySelector('.hero-section');
        if (hero) {
            hero.style.transform = `translateY(${scrolled * 0.5}px)`;
        }
    }

    promptForCustomUrl() {
        const url = prompt('Enter a stream URL (YouTube, m3u8, mp4, etc.):');
        if (url && url.trim()) {
            const cleanUrl = url.trim();
            console.log('🔗 Playing custom URL:', cleanUrl);
            
            const customChannel = {
                name: 'Custom Stream',
                group: 'User Input',
                logo: '',
                resolution: 'LIVE',
                url: cleanUrl,
                id: 'custom-' + Date.now()
            };

            this.currentChannelIndex = -1;
            this.updateChannelInfo(customChannel);
            this.updateSidebarInfo(customChannel);
            this.updateProgramPanel(customChannel);
            this.loadChannel(cleanUrl, customChannel);
            
            if (window.innerWidth <= 768) {
                this.toggleSidebar(false);
            }
        }
    }

    onPlay() {
        this.isPlaying = true;
        if (this.videoWrapper) {
            this.videoWrapper.classList.remove('is-paused');
        }
        this.setControlsOverlayVisible(true, true);
        const playIcon = this.playPauseBtn.querySelector('i');
        playIcon.className = 'fas fa-pause';
        this.showLoading(false);
        console.log('Channel playing successfully');
    }

    onPause() {
        this.isPlaying = false;
        if (this.videoWrapper) {
            this.videoWrapper.classList.add('is-paused');
        }
        this.setControlsOverlayVisible(true, true);
        const playIcon = this.playPauseBtn.querySelector('i');
        playIcon.className = 'fas fa-play';
    }

    onError(event) {
        console.error('Video error:', event);
        this.showLoading(false);
        this.showError('Failed to load channel. This stream may be offline or geo-restricted.');
        
        setTimeout(() => {
            if (this.channels.length > 1) {
                console.log('Attempting next channel...');
                this.nextChannel();
            }
        }, 2000);
    }

    onLoadStart() {
        this.showLoading(true);
    }

    onCanPlay() {
        this.showLoading(false);
        this.setControlsOverlayVisible(true, true);
    }

    showLoading(show) {
        if (show) {
            this.loadingOverlay.classList.add('active');
        } else {
            this.loadingOverlay.classList.remove('active');
        }
    }

    showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-notification';
        errorDiv.innerHTML = `
            <div style="
                position: fixed;
                top: 100px;
                right: 20px;
                background: #e50914;
                color: white;
                padding: 1rem 1.5rem;
                border-radius: 8px;
                box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
                z-index: 2000;
                max-width: 300px;
            ">
                <strong><i class="fas fa-exclamation-circle"></i> Error</strong>
                <p style="margin: 0.5rem 0 0;">${message}</p>
            </div>
        `;
        
        document.body.appendChild(errorDiv);
        
        setTimeout(() => {
            if (errorDiv.parentNode) {
                errorDiv.parentNode.removeChild(errorDiv);
            }
        }, 5000);
    }

    isMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) ||
               (window.matchMedia && window.matchMedia('(max-width: 768px)').matches);
    }

    isElectron() {
        return !!window.streamflixDesktop || /Electron/i.test(navigator.userAgent);
    }

    initializeMobileFeatures() {
        if (this.isMobileDevice()) {
            console.log('Mobile device detected - optimizing controls');
            
            const controls = document.querySelector('.player-controls-overlay');
            if (controls) {
                controls.addEventListener('touchend', (e) => {
                    const target = e.target.closest('button, input');
                    if (target) {
                        this.setControlsOverlayVisible(true, true);
                        e.preventDefault();
                        target.click();
                    }
                }, { passive: false });
            }
        }
    }
}

function initializeStreamFlixPlayer() {
    console.log('🔍 Checking if player should be initialized...');
    
    const videoPlayer = document.getElementById('video-player');
    const playerPage = document.querySelector('.video-player-page');
    const playerContainer = document.querySelector('.player-container');
    
    console.log('Video player element:', videoPlayer);
    console.log('Player page class:', playerPage);
    console.log('Player container:', playerContainer);
    
    if (videoPlayer && (playerPage || playerContainer)) {
        console.log('🎬 StreamFlix Player Initializing...');
        try {
            window.netflixPlayer = new NetflixIPTVPlayer();
            console.log('✅ StreamFlix Player Ready!');
            return true;
        } catch (error) {
            console.error('❌ Player initialization failed:', error);
            return false;
        }
    } else {
        console.log('🏠 Not on player page or missing essential elements - skipping player initialization');
        return false;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    console.log('📄 DOM Content Loaded');
    initializeStreamFlixPlayer();
});
