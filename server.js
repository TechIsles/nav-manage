const express = require('express');
const fs = require('fs');
const yaml = require('js-yaml');
const cors = require('cors');
const axios = require('axios');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8980;

const DATA_DIR = process.env.DATA_DIR || '/data/';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_BRANCH = process.env.GITHUB_BRANCH || 'main';
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const NAVIGATION_URL = process.env.NAVIGATION_URL;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const STORAGE_FILE_PATH = process.env.STORAGE_FILE_PATH;
const RSS_FILE_PATH = process.env.RSS_FILE_PATH || '/themes/WebStack-Hugo/static/rss.xml';
const BOOKMARKS_OUTPUT_DIR = process.env.BOOKMARKS_OUTPUT_DIR || '/themes/WebStack-Hugo/static/bookmarks/';
const BOOKMARKS_FILE_NAME = 'bookmarks.html';

if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.error('请设置 GITHUB_TOKEN 和 GITHUB_REPO 环境变量。');
    process.exit(1);
}

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'PUT'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());

let updateNotifications = []; // 存储更新通知

const getGitHubFileUrl = (filename) => {
    return `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/${DATA_DIR}${filename}`;
};

const uploadFileToGitHub = async (filename, content) => {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`;
    
    try {
        const response = await axios.get(url, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });

        const sha = response.data.sha;

        await axios.put(url, {
            message: `Update ${filename}`,
            content: Buffer.from(content).toString('base64'),
            sha: sha
        }, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });
    } catch (err) {
        if (err.response && err.response.status === 404) {
            await axios.put(url, {
                message: `Create ${filename}`,
                content: Buffer.from(content).toString('base64')
            }, {
                headers: {
                    Authorization: `token ${GITHUB_TOKEN}`,
                    Accept: 'application/vnd.github.v3+json'
                }
            });
        } else {
            console.error('上传文件到 GitHub 时出错:', err.response ? err.response.data : err);
            throw new Error('上传文件失败');
        }
    }
};

const sendTelegramNotification = async (message) => {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;

    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const title = "导航站收录更新通知！";

    try {
        await axios.post(url, {
            chat_id: TELEGRAM_CHAT_ID,
            text: `<b>${title}</b>\n${message}`,
            parse_mode: 'HTML'
        });
    } catch (err) {
        console.error('发送 Telegram 通知时出错:', err);
    }
};

const sendWebhookNotification = async (notification) => {
    if (!WEBHOOK_URL) return;

    try {
        await axios.post(WEBHOOK_URL, {
            title: notification.title,
            logo: notification.logo,
            url: notification.url,
            description: notification.description,
            navigation_url: NAVIGATION_URL
        });
    } catch (err) {
        console.error('发送 Webhook 通知时出错:', err);
    }
};

const escapeXML = (str) => {
    return str.replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;');
};

const generateRSS = (notifications) => {
    const rssItems = notifications.map(notification => `
        <item>
            <title>${escapeXML(notification.title || '')}</title>
            <link>${escapeXML(notification.url || '')}</link>
            <description>${escapeXML(notification.description || '')}</description>
            <guid>${escapeXML(notification.url || '')}</guid>
            <pubDate>${new Date(notification.date).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}</pubDate>
        </item>
    `).join('');

    return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0">
<channel>
    <title>${escapeXML(process.env.RSS_TITLE || 'NOISE导航收录更新')}</title>
    <link>${escapeXML(process.env.RSS_LINK || 'http://www.noisedh.cn')}</link>
    <description>${escapeXML(process.env.RSS_DESCRIPTION || '最新更新通知')}</description>
    ${rssItems}
</channel>
</rss>`;
};

const saveNotifications = () => {
    if (!STORAGE_FILE_PATH) return;

    try {
        // 确保目录存在
        if (!fs.existsSync(path.dirname(STORAGE_FILE_PATH))) {
            fs.mkdirSync(path.dirname(STORAGE_FILE_PATH), { recursive: true });
        }

        const dataToSave = JSON.stringify(updateNotifications.slice(0, 40), null, 2);
        fs.writeFileSync(STORAGE_FILE_PATH, dataToSave);

        // 生成 RSS 文件
        const rssContent = generateRSS(updateNotifications);
        if (!fs.existsSync(path.dirname(RSS_FILE_PATH))) {
            fs.mkdirSync(path.dirname(RSS_FILE_PATH), { recursive: true });
        }
        fs.writeFileSync(RSS_FILE_PATH, rssContent, 'utf8');
    } catch (err) {
        console.error('保存通知数据时出错:', err);
    }
};

// 生成书签 HTML
const generateBookmarksHtml = (bookmarks, title = 'Noise导航-Bookmarks', h1 = 'Noise导航-Bookmarks') => {
    let bookmarkHtml = '<!DOCTYPE NETSCAPE-Bookmark-file-1>\n';
    bookmarkHtml += '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n';
    bookmarkHtml += `<TITLE>${title}</TITLE>\n<H1>${h1}</H1>\n<DL><p>\n`;

    bookmarks.forEach(bookmark => {
        if (bookmark.isHeader) {
            bookmarkHtml += `    <DT><H3 ADD_DATE="${Date.now()}">${bookmark.title}</H3>\n`;
        } else {
            bookmarkHtml += `    <DT><A HREF="${bookmark.url}">${bookmark.title}</A>\n`;
        }
    });

    bookmarkHtml += '</DL><p>';
    return bookmarkHtml;
};

// 确保目录存在
const ensureDirectoryExists = (dirPath) => {
    return new Promise((resolve, reject) => {
        fs.mkdir(dirPath, { recursive: true }, (err) => {
            if (err) {
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

app.get('/data', async (req, res) => {
    const folderPath = DATA_DIR;
    try {
        const response = await axios.get(`https://api.github.com/repos/${GITHUB_REPO}/contents/${folderPath}`, {
            headers: {
                Authorization: `token ${GITHUB_TOKEN}`,
                Accept: 'application/vnd.github.v3+json'
            }
        });
        const yamlFiles = response.data
            .filter(file => typeof file.name === 'string' && (file.name.endsWith('.yaml') || file.name.endsWith('.yml')))
            .map(file => file.name);
        res.json(yamlFiles);
    } catch (err) {
        console.error('读取文件夹时出错:', err.response ? err.response.data : err);
        return res.status(500).send('读取文件夹失败');
    }
});

app.get('/data/:filename', async (req, res) => {
    const filename = req.params.filename;
    const fileUrl = getGitHubFileUrl(filename);

    try {
        const response = await axios.get(fileUrl);
        res.send(response.data);
    } catch (err) {
        console.error('读取文件时出错:', err.response ? err.response.data : err);
        if (err.response && err.response.status === 404) {
            return res.status(404).send('文件未找到');
        }
        return res.status(500).send('读取文件失败');
    }
});

app.post('/api/yaml', async (req, res) => {
    const { filename, newDataEntry } = req.body;

    if (!newDataEntry.title || !newDataEntry.url || !newDataEntry.logo || !newDataEntry.description) {
        return res.status(400).send('所有字段（标题、地址、Logo 和描述）都必须填写！');
    }

    const fileUrl = getGitHubFileUrl(filename);

    try {
        const response = await axios.get(fileUrl);
        let yamlData = [];

        if (response.status === 200) {
            yamlData = yaml.load(response.data) || [];
        }

        const taxonomyEntry = yamlData.find(entry => entry.taxonomy === newDataEntry.taxonomy);

        if (taxonomyEntry) {
            if (newDataEntry.term) {
                const termEntry = taxonomyEntry.list?.find(term => term.term === newDataEntry.term);
                if (termEntry) {
                    termEntry.links = termEntry.links || [];
                    termEntry.links.push({
                        title: newDataEntry.title,
                        logo: newDataEntry.logo,
                        url: newDataEntry.url,
                        description: newDataEntry.description
                    });
                }
            } else {
                taxonomyEntry.links = taxonomyEntry.links || [];
                taxonomyEntry.links.push({
                    title: newDataEntry.title,
                    logo: newDataEntry.logo,
                    url: newDataEntry.url,
                    description: newDataEntry.description
                });
            }
        } else {
            const newTaxonomyEntry = {
                taxonomy: newDataEntry.taxonomy,
                icon: newDataEntry.icon || '',
                links: newDataEntry.term ? [] : [{
                    title: newDataEntry.title,
                    logo: newDataEntry.logo,
                    url: newDataEntry.url,
                    description: newDataEntry.description
                }]
            };
            yamlData.push(newTaxonomyEntry);
        }

        const yamlString = '---\n' + yaml.dump(yamlData, { noRefs: true, lineWidth: -1 });

        await uploadFileToGitHub(filename, yamlString);

        const notification = {
            title: newDataEntry.title,
            logo: newDataEntry.logo,
            url: newDataEntry.url,
            description: newDataEntry.description,
            date: new Date().toISOString()
        };

        updateNotifications.unshift(notification);
        if (updateNotifications.length > 40) {
            updateNotifications.pop();
        }

        saveNotifications();

        const message = `
网站名称: ${notification.title}
Logo: ${notification.logo}
链接: ${notification.url}
描述: ${notification.description}
前往导航：${NAVIGATION_URL}
`.trim();

        await sendTelegramNotification(message);
        await sendWebhookNotification(notification);

        res.send('数据添加成功！');
    } catch (err) {
        console.error('处理 YAML 文件时出错:', err);
        return res.status(500).send('处理 YAML 文件失败');
    }
});

app.get('/api/notifications', (req, res) => {
    if (updateNotifications.length === 0) {
        return res.json({ message: '暂无更新的内容' });
    }
    res.json(updateNotifications);
});

app.get('/api/search', async (req, res) => {
    const { keyword, filePath } = req.query;

    if (!keyword || !filePath) {
        return res.status(400).send('缺少关键词或文件路径');
    }

    const fileUrl = getGitHubFileUrl(filePath);

    try {
        const response = await axios.get(fileUrl);
        const yamlData = yaml.load(response.data) || [];

        const results = [];
        yamlData.forEach(entry => {
            if (entry.links) {
                entry.links.forEach(link => {
                    if (
                        (typeof link.title === 'string' && link.title.includes(keyword)) || 
                        (typeof link.description === 'string' && link.description.includes(keyword))
                    ) {
                        results.push(link);
                    }
                });
            }
            if (entry.list) {
                entry.list.forEach(termEntry => {
                    if (termEntry.links) {
                        termEntry.links.forEach(link => {
                            if (
                                (typeof link.title === 'string' && link.title.includes(keyword)) || 
                                (typeof link.description === 'string' && link.description.includes(keyword))
                            ) {
                                results.push(link);
                            }
                        });
                    }
                });
            }
        });

        res.json(results);
    } catch (err) {
        console.error('搜索处理时出错:', err);
        return res.status(500).send('搜索处理失败');
    }
});

app.delete('/api/delete', async (req, res) => {
    const { filename, title } = req.body;

    if (!filename) {
        return res.status(400).send('未提供文件路径');
    }

    const fileUrl = getGitHubFileUrl(filename);

    try {
        const response = await axios.get(fileUrl);
        let yamlData = [];

        if (response.status === 200) {
            yamlData = yaml.load(response.data) || [];
        }

        let deleted = false;
        yamlData.forEach(entry => {
            if (entry.links) {
                entry.links = entry.links.filter(link => {
                    if (link.title === title) {
                        deleted = true;
                        return false; 
                    }
                    return true; 
                });
            }
            if (entry.list) {
                entry.list.forEach(termEntry => {
                    if (termEntry.links) {
                        termEntry.links = termEntry.links.filter(link => {
                            if (link.title === title) {
                                deleted = true;
                                return false; 
                            }
                            return true; 
                        });
                    }
                });
            }
        });

        if (!deleted) {
            return res.status(404).send('未找到匹配的条目');
        }

        const yamlString = '---\n' + yaml.dump(yamlData, { noRefs: true, lineWidth: -1 });
        await uploadFileToGitHub(filename, yamlString);
        res.send('条目删除成功！');
    } catch (err) {
        console.error('处理 YAML 文件时出错:', err);
        return res.status(500).send('处理 YAML 文件失败');
    }
});

app.put('/api/update', async (req, res) => {
    const { filename, title, updatedData } = req.body;

    if (!filename || !title || !updatedData) {
        return res.status(400).send('未提供文件名、标题或更新数据');
    }

    const fileUrl = getGitHubFileUrl(filename);

    try {
        const response = await axios.get(fileUrl);
        let yamlData = [];

        if (response.status === 200) {
            yamlData = yaml.load(response.data) || [];
        }

        let updated = false;
        yamlData.forEach(entry => {
            if (entry.links) {
                entry.links.forEach(link => {
                    if (link.title === title) {
                        Object.assign(link, updatedData);
                        updated = true;
                    }
                });
            }
            if (entry.list) {
                entry.list.forEach(termEntry => {
                    if (termEntry.links) {
                        termEntry.links.forEach(link => {
                            if (link.title === title) {
                                Object.assign(link, updatedData);
                                updated = true;
                            }
                        });
                    }
                });
            }
        });

        if (!updated) {
            return res.status(404).send('未找到匹配的条目');
        }

        const yamlString = '---\n' + yaml.dump(yamlData, { noRefs: true, lineWidth: -1 });
        await uploadFileToGitHub(filename, yamlString);
        res.send('条目更新成功！');
    } catch (err) {
        console.error('处理 YAML 文件时出错:', err);
        return res.status(500).send('处理 YAML 文件失败');
    }
});

app.get('/api/export-bookmarks', async (req, res) => {
    const bookmarks = [];

    // 确保输出目录存在
    const outputPath = path.resolve(BOOKMARKS_OUTPUT_DIR);
    await ensureDirectoryExists(outputPath);

    const dataDir = path.resolve(DATA_DIR);

    try {
        const yamlFiles = await fs.promises.readdir(dataDir);

        for (const file of yamlFiles) {
            if (file.endsWith('.yaml') || file.endsWith('.yml')) {
                const filePath = path.join(dataDir, file);
                const yamlContent = await fs.promises.readFile(filePath, 'utf8');
                const yamlData = yaml.load(yamlContent);

                yamlData.forEach(category => {
                    // 添加一级标题
                    const taxonomyTitle = category.taxonomy; // 假设 taxonomy 在 category 中
                    if (taxonomyTitle) {
                        bookmarks.push({ title: taxonomyTitle, url: '', isHeader: true });
                    }

                    if (Array.isArray(category.links)) {
                        category.links.forEach(link => {
                            bookmarks.push({ title: link.title, url: link.url });
                        });
                    }

                    if (Array.isArray(category.list)) {
                        category.list.forEach(subCategory => {
                            // 添加二级标题
                            const termTitle = subCategory.term; // 假设 term 在 subCategory 中
                            if (termTitle) {
                                bookmarks.push({ title: termTitle, url: '', isHeader: true });
                            }

                            if (Array.isArray(subCategory.links)) {
                                subCategory.links.forEach(link => {
                                    bookmarks.push({ title: link.title, url: link.url });
                                });
                            }
                        });
                    }
                });
            }
        }

        const bookmarkHtml = generateBookmarksHtml(bookmarks, process.env.BOOKMARKS_TITLE, process.env.BOOKMARKS_H1);

        // 写入书签文件，每次都覆盖上一个文件
        const fullOutputPath = path.join(outputPath, BOOKMARKS_FILE_NAME);
        await fs.promises.writeFile(fullOutputPath, bookmarkHtml, 'utf8');

        // 直接下载生成的书签文件
        res.download(fullOutputPath, BOOKMARKS_FILE_NAME, (err) => {
            if (err) {
                console.error('Error downloading file:', err);
                res.status(500).send('文件下载失败');
            }
        });
    } catch (err) {
        console.error('生成书签文件时出错:', err);
        return res.status(500).send('生成书签文件失败');
    }
});

app.listen(PORT, () => {
    console.log(`服务器正在运行在 http://localhost:${PORT}`);
    console.log('可用的路由:');
    console.log('GET /api/export-bookmarks');
    console.log('GET /data');
    console.log('GET /data/:filename');
    console.log('GET /api/notifications');
    console.log('POST /api/yaml');
    console.log('GET /api/search');
    console.log('DELETE /api/delete');
    console.log('PUT /api/update');
});
