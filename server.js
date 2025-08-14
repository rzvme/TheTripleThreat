const express = require('express');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const validator = require('validator');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - IMPORTANT for K3s/ingress environments
app.set('trust proxy', true);

// Discord webhook URL (set this as environment variable)
const DISCORD_WEBHOOK_URL = "<<webhookurl>>";

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"], // Allow inline styles for our CSS
            scriptSrc: ["'self'", "'unsafe-inline'"], // Allow inline scripts
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'"], // For fetch requests
            fontSrc: ["'self'"],
        },
    },
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// In-memory store for rate limiting by IP (in production, use Redis)
const applicationStore = new Map();

// General rate limiting for other endpoints
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        error: 'Too many requests from this IP, please try again later.'
    },
    keyGenerator: (req) => {
        // Use the same IP detection logic
        return req.ip ||
            req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
            req.headers['x-real-ip'] ||
            req.headers['cf-connecting-ip'] ||
            req.connection.remoteAddress ||
            'unknown';
    }
});

// Apply general rate limiting to all routes
app.use(generalLimiter);

// Serve static files
app.use(express.static('.'));

// Custom rate limiting middleware for applications
function applicationRateLimit(req, res, next) {
    // Get real client IP from headers set by ingress/proxy
    const clientIP = req.ip ||
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.headers['cf-connecting-ip'] || // Cloudflare
        req.connection.remoteAddress ||
        req.socket.remoteAddress ||
        'unknown';

    console.log(`Rate limit check for IP: ${clientIP}, Headers:`, {
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-real-ip': req.headers['x-real-ip'],
        'req.ip': req.ip
    });

    const now = Date.now();
    const sixMonthsInMs = 6 * 30 * 24 * 60 * 60 * 1000; // 6 months in milliseconds

    const record = applicationStore.get(clientIP);

    if (record && (now - record.timestamp) < sixMonthsInMs) {
        // Still within 6 months since last application
        const timeLeft = sixMonthsInMs - (now - record.timestamp);
        const daysLeft = Math.ceil(timeLeft / (24 * 60 * 60 * 1000));

        console.log(`Rate limit hit for IP ${clientIP}. Days left: ${daysLeft}`);

        return res.status(429).json({
            success: false,
            message: `You have already submitted an application recently. Please wait ${daysLeft} more days before submitting another application.`,
            error: 'RATE_LIMITED'
        });
    }

    // Record this submission
    //applicationStore.set(clientIP, {
    //    timestamp: now,
    //    submissions: (record?.submissions || 0) + 1
    //});

    console.log(`Application allowed for IP ${clientIP}`);
    next();
}

// Validation functions
function validateApplicationData(data) {
    const errors = [];

    // Character name validation
    if (!data.characterName || typeof data.characterName !== 'string') {
        errors.push('Character name is required');
    } else if (!validator.isLength(data.characterName.trim(), { min: 2, max: 12 })) {
        errors.push('Character name must be between 2-12 characters');
    } else if (!/^[a-zA-Z]+$/.test(data.characterName.trim())) {
        errors.push('Character name can only contain letters');
    }

    // Discord ID validation
    if (!data.discordId || typeof data.discordId !== 'string') {
        errors.push('Discord ID is required');
    } else if (!/^.{2,32}#\d{4}$/.test(data.discordId.trim()) && !/^[a-z0-9_.]{2,32}$/.test(data.discordId.trim())) {
        errors.push('Discord ID must be in format "username#1234" or new format "username"');
    }

    // Class validation
    const validClasses = ['Death Knight', 'Demon Hunter', 'Druid', 'Evoker', 'Hunter', 'Mage', 'Monk', 'Paladin', 'Priest', 'Rogue', 'Shaman', 'Warlock', 'Warrior'];
    if (!data.class || !validClasses.includes(data.class)) {
        errors.push('Invalid class selected');
    }

    // Spec validation
    if (!data.spec || typeof data.spec !== 'string') {
        errors.push('Main specialization is required');
    } else if (!validator.isLength(data.spec.trim(), { min: 2, max: 30 })) {
        errors.push('Specialization must be between 2-30 characters');
    }

    // Item level validation (optional)
    if (data.itemLevel && (!validator.isInt(data.itemLevel.toString(), { min: 400, max: 600 }))) {
        errors.push('Item level must be between 400-600');
    }

    // Experience validation (optional)
    const validExperience = ['Normal', 'Heroic', 'Mythic', 'Cutting Edge'];
    if (data.experience && !validExperience.includes(data.experience)) {
        errors.push('Invalid experience level');
    }

    // Text field validation (prevent XSS and limit length)
    if (data.availability && !validator.isLength(data.availability.trim(), { max: 500 })) {
        errors.push('Availability description is too long (max 500 characters)');
    }

    if (data.motivation && !validator.isLength(data.motivation.trim(), { max: 1000 })) {
        errors.push('Motivation description is too long (max 1000 characters)');
    }

    // URL validation for logs (optional)
    if (data.logs && data.logs.trim() && !validator.isURL(data.logs.trim(), {
        protocols: ['http', 'https'],
        require_protocol: true
    })) {
        errors.push('Combat logs must be a valid URL');
    }

    return errors;
}

// Sanitize text to prevent injection
function sanitizeText(text) {
    if (!text) return '';
    return validator.escape(text.trim());
}

// Send to Discord
async function sendToDiscord(applicationData) {
    if (!DISCORD_WEBHOOK_URL) {
        console.log('Discord webhook URL not configured');
        return;
    }

    const embed = {
        title: "🆕 New Guild Application",
        color: 0x5a9bc4, // Blue color
        fields: [
            {
                name: "👤 Character",
                value: `**${applicationData.characterName}** (${applicationData.class} - ${applicationData.spec})`,
                inline: true
            },
            {
                name: "💬 Discord",
                value: applicationData.discordId,
                inline: true
            },
            {
                name: "⚔️ Item Level",
                value: applicationData.itemLevel || 'Not specified',
                inline: true
            },
            {
                name: "🏆 Experience",
                value: applicationData.experience || 'Not specified',
                inline: true
            },
            {
                name: "📅 Availability",
                value: applicationData.availability || 'Not specified',
                inline: false
            },
            {
                name: "💭 Motivation",
                value: applicationData.motivation || 'Not specified',
                inline: false
            }
        ],
        timestamp: new Date().toISOString(),
        footer: {
            text: "The Triple Threat • Guild Application"
        }
    };

    if (applicationData.logs) {
        embed.fields.push({
            name: "📊 Combat Logs",
            value: applicationData.logs,
            inline: false
        });
    }

    const payload = {
        username: "Guild Bot",
        embeds: [embed]
    };

    try {
        const response = await fetch(DISCORD_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Discord API error: ${response.status}`);
        }

        console.log('Application sent to Discord successfully');
    } catch (error) {
        console.error('Failed to send to Discord:', error);
        throw error;
    }
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.html'));
});
app.get('/main.css', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.css'));
});
app.get('/main.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'main.js'));
});

app.post('/api/application', applicationRateLimit, async (req, res) => {
    try {
        // Validate input data
        const errors = validateApplicationData(req.body);

        if (errors.length > 0) {
            return res.status(400).json({
                success: false,
                errors: errors
            });
        }

        // Sanitize data
        const sanitizedData = {
            characterName: sanitizeText(req.body.characterName),
            discordId: sanitizeText(req.body.discordId),
            class: sanitizeText(req.body.class),
            spec: sanitizeText(req.body.spec),
            itemLevel: req.body.itemLevel ? parseInt(req.body.itemLevel) : null,
            experience: sanitizeText(req.body.experience),
            availability: sanitizeText(req.body.availability),
            motivation: sanitizeText(req.body.motivation),
            logs: req.body.logs ? sanitizeText(req.body.logs) : null
        };

        // Send to Discord
        await sendToDiscord(sanitizedData);

        // Log the application (in production, save to database)
        const logEntry = {
            timestamp: new Date().toISOString(),
            ip: req.ip,
            data: sanitizedData
        };

        console.log('New application received:', logEntry);

        res.json({
            success: true,
            message: 'Application submitted successfully! We will review it and contact you on Discord within 48 hours.'
        });

    } catch (error) {
        console.error('Application submission error:', error);

        res.status(500).json({
            success: false,
            message: 'An error occurred while processing your application. Please try again later.'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: 'An internal server error occurred'
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

app.listen(PORT, () => {
    console.log(`🚀 Guild website server running on port ${PORT}`);
    console.log(`🔗 Access at: http://localhost:${PORT}`);
    if (!DISCORD_WEBHOOK_URL) {
        console.warn('⚠️  DISCORD_WEBHOOK_URL environment variable not set');
    }
});

module.exports = app;
