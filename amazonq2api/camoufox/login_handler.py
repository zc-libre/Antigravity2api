#!/usr/bin/env python3
"""
使用 Camoufox 反检测浏览器完成 Amazon 设备授权登录/注册。
Camoufox 在 C++ 内核层修改指纹，比 JS 注入更难被检测。
"""
import os
import sys
import json
import time
import random
import argparse
import re
import requests
from typing import Optional, Tuple, List
from dataclasses import dataclass, asdict

from camoufox.sync_api import Camoufox
from playwright.sync_api import Page, Frame, Locator, TimeoutError as PlaywrightTimeout

# 尝试导入 pyotp（用于 MFA）
try:
    import pyotp
    HAS_PYOTP = True
except ImportError:
    HAS_PYOTP = False


@dataclass
class Credentials:
    email: str
    password: str
    mfa_secret: Optional[str] = None


@dataclass
class RegistrationOptions:
    """注册选项"""
    gptmail_base_url: str
    gptmail_api_key: str
    password: Optional[str] = None  # 可选，未提供时自动生成符合要求的密码
    email_prefix: Optional[str] = None
    email_domain: Optional[str] = None
    full_name: Optional[str] = None


@dataclass
class LoginResult:
    success: bool
    message: str
    error_code: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None


def random_delay(min_ms: int = 500, max_ms: int = 2000) -> None:
    """模拟人类操作的随机延迟"""
    time.sleep(random.randint(min_ms, max_ms) / 1000)


def get_all_frames(page: Page) -> List[Frame]:
    """返回页面内的所有 frame（包含主 frame），用于在 iframe 中查找控件。"""
    frames: List[Frame] = []
    seen_ids = set()
    try:
        main_frame = page.main_frame
        if main_frame and id(main_frame) not in seen_ids:
            frames.append(main_frame)
            seen_ids.add(id(main_frame))
    except Exception:
        pass
    
    for frame in page.frames:
        if not frame:
            continue
        frame_id = id(frame)
        if frame_id in seen_ids:
            continue
        frames.append(frame)
        seen_ids.add(frame_id)
    
    return frames


def locator_is_visible(locator: Locator, timeout: int = 2000) -> bool:
    """确保定位到的元素可见，可 fallback 到 bounding_box 检测。"""
    try:
        return locator.is_visible(timeout=timeout)
    except Exception:
        try:
            box = locator.bounding_box()
            return bool(box and box.get("width") and box.get("height"))
        except Exception:
            return False


def human_like_click(page: Page, locator: Locator, description: str = "目标元素") -> bool:
    """在点击元素前进行滚动与鼠标移动，统一采用人类化点击逻辑。"""
    try:
        locator.scroll_into_view_if_needed(timeout=2000)
    except Exception:
        pass
    
    try:
        box = locator.bounding_box()
        if box:
            human_mouse_move(
                page,
                int(box["x"] + box["width"] / 2),
                int(box["y"] + box["height"] / 2)
            )
    except Exception:
        pass
    
    random_delay(300, 600)
    
    try:
        locator.click(timeout=5000)
        return True
    except Exception as click_err:
        print(f"[!] {description} 点击失败: {click_err}")
        return False


def center_browser_window(page: Page, width: int = 1280, height: int = 800) -> None:
    """
    将浏览器窗口居中显示
    """
    try:
        # 设置视口大小
        page.set_viewport_size({"width": width, "height": height})
        
        # 尝试使用 JavaScript 获取屏幕信息并居中窗口
        # 注意：某些浏览器可能限制 window.moveTo
        page.evaluate("""
            () => {
                const screenWidth = window.screen.availWidth || 1920;
                const screenHeight = window.screen.availHeight || 1080;
                const windowWidth = window.outerWidth || 1280;
                const windowHeight = window.outerHeight || 800;
                const left = Math.max(0, (screenWidth - windowWidth) / 2);
                const top = Math.max(0, (screenHeight - windowHeight) / 2);
                try {
                    window.moveTo(left, top);
                } catch (e) {
                    // 某些浏览器不支持 moveTo
                }
            }
        """)
        print(f"[*] 窗口大小设置为 {width}x{height}")
    except Exception as e:
        print(f"[!] 设置窗口位置失败: {e}")


def human_mouse_move(page: Page, x: int, y: int) -> None:
    """模拟人类鼠标移动（带有轻微抖动）"""
    try:
        # 获取当前鼠标位置（假设从随机位置开始）
        current_x = random.randint(100, 500)
        current_y = random.randint(100, 300)
        
        # 分步移动
        steps = random.randint(5, 10)
        for i in range(steps):
            progress = (i + 1) / steps
            # 添加轻微随机偏移
            jitter_x = random.randint(-3, 3)
            jitter_y = random.randint(-3, 3)
            next_x = int(current_x + (x - current_x) * progress) + jitter_x
            next_y = int(current_y + (y - current_y) * progress) + jitter_y
            page.mouse.move(next_x, next_y)
            time.sleep(random.uniform(0.01, 0.03))
    except:
        pass


def simulate_human_behavior(page: Page) -> None:
    """模拟人类浏览行为（滚动、移动鼠标等）"""
    print("[*] 模拟人类浏览行为...")
    
    try:
        # 1. 随机移动鼠标几次
        for _ in range(random.randint(2, 4)):
            x = random.randint(200, 800)
            y = random.randint(200, 600)
            human_mouse_move(page, x, y)
            random_delay(200, 500)
        
        # 2. 轻微滚动页面
        scroll_amount = random.randint(50, 150)
        page.mouse.wheel(0, scroll_amount)
        random_delay(500, 1000)
        
        # 滚动回去
        page.mouse.wheel(0, -scroll_amount // 2)
        random_delay(300, 600)
        
        # 3. 再移动一下鼠标
        human_mouse_move(page, random.randint(300, 600), random.randint(300, 500))
        random_delay(500, 1000)
        
    except Exception as e:
        print(f"[!] 模拟行为时出错: {e}")


def human_type(page: Page, selector: str, text: str) -> None:
    """模拟人类打字速度（更慢更自然）"""
    element = page.locator(selector).first
    
    # 先移动鼠标到元素附近
    try:
        box = element.bounding_box()
        if box:
            target_x = int(box['x'] + box['width'] / 2 + random.randint(-10, 10))
            target_y = int(box['y'] + box['height'] / 2 + random.randint(-5, 5))
            human_mouse_move(page, target_x, target_y)
    except:
        pass
    
    random_delay(300, 600)
    element.click()
    random_delay(400, 800)
    
    for char in text:
        # 更慢的打字速度（100-250ms 每个字符）
        element.type(char, delay=random.randint(100, 250))
        # 更频繁的停顿（20% 概率）
        if random.random() < 0.2:
            random_delay(200, 500)
        # 偶尔更长的停顿（5% 概率，模拟思考）
        if random.random() < 0.05:
            random_delay(500, 1000)


def generate_display_name() -> str:
    """生成随机显示名称"""
    first_names = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Quinn", "Avery"]
    last_names = ["Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis"]
    return f"{random.choice(first_names)} {random.choice(last_names)}"


def generate_secure_password(length: int = 12) -> str:
    """
    生成符合 AWS 要求的安全密码
    要求：大写字母 + 小写字母 + 数字 + 特殊字符，长度 > 8
    """
    import string
    
    if length < 9:
        length = 12  # 确保长度大于 8
    
    # 定义字符集
    uppercase = string.ascii_uppercase  # A-Z
    lowercase = string.ascii_lowercase  # a-z
    digits = string.digits              # 0-9
    # AWS 允许的特殊字符（避免可能引起问题的字符）
    special = "!@#$%^&*()-_=+"
    
    # 确保每种类型至少有一个
    password = [
        random.choice(uppercase),
        random.choice(lowercase),
        random.choice(digits),
        random.choice(special),
    ]
    
    # 填充剩余长度
    all_chars = uppercase + lowercase + digits + special
    password.extend(random.choice(all_chars) for _ in range(length - 4))
    
    # 打乱顺序
    random.shuffle(password)
    
    return ''.join(password)


def validate_password(password: str) -> Tuple[bool, str]:
    """
    验证密码是否符合 AWS 要求
    返回: (是否有效, 错误信息)
    """
    import string
    
    if len(password) <= 8:
        return False, "密码长度必须大于 8 个字符"
    
    has_upper = any(c in string.ascii_uppercase for c in password)
    has_lower = any(c in string.ascii_lowercase for c in password)
    has_digit = any(c in string.digits for c in password)
    has_special = any(c in "!@#$%^&*()-_=+[]{}|;:,.<>?" for c in password)
    
    if not has_upper:
        return False, "密码必须包含大写字母"
    if not has_lower:
        return False, "密码必须包含小写字母"
    if not has_digit:
        return False, "密码必须包含数字"
    if not has_special:
        return False, "密码必须包含特殊字符"
    
    return True, "密码格式有效"


# ==================== GPTMail 集成 ====================

class GPTMailClient:
    """GPTMail 临时邮箱客户端"""
    
    def __init__(self, base_url: str, api_key: str, proxy: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.session = requests.Session()
        # 使用 x-api-key header（与 TypeScript 版本一致）
        self.session.headers["x-api-key"] = api_key
        self.session.headers["Content-Type"] = "application/json"
        self.session.headers["Accept"] = "application/json"
        if proxy:
            self.session.proxies = {"http": proxy, "https": proxy}
    
    def generate_email(self, prefix: Optional[str] = None, domain: Optional[str] = None) -> str:
        """生成临时邮箱地址"""
        # 使用正确的 API 端点: /api/generate-email
        if prefix or domain:
            # POST 请求带参数
            payload = {}
            if prefix:
                payload["prefix"] = prefix
            if domain:
                payload["domain"] = domain
            resp = self.session.post(f"{self.base_url}/api/generate-email", json=payload)
        else:
            # GET 请求
            resp = self.session.get(f"{self.base_url}/api/generate-email")
        
        resp.raise_for_status()
        data = resp.json()
        
        # 处理响应格式: { success: true, data: { email: "..." } }
        if data.get("success") and data.get("data"):
            return data["data"].get("email")
        # 兼容直接返回格式
        return data.get("email") or data.get("address")
    
    def get_emails(self, email: str) -> list:
        """获取邮件列表"""
        resp = self.session.get(f"{self.base_url}/api/emails", params={"email": email})
        resp.raise_for_status()
        data = resp.json()
        
        if data.get("success") and data.get("data"):
            return data["data"].get("emails", [])
        return data.get("emails", [])
    
    def get_email_detail(self, email_id: str) -> dict:
        """获取邮件详情"""
        resp = self.session.get(f"{self.base_url}/api/email/{email_id}")
        resp.raise_for_status()
        data = resp.json()
        
        if data.get("success") and data.get("data"):
            return data["data"]
        return data
    
    def wait_for_verification_code(
        self, 
        email: str, 
        timeout_ms: int = 120000,
        poll_interval_ms: int = 3000
    ) -> str:
        """等待并获取验证码"""
        start_time = time.time()
        timeout_sec = timeout_ms / 1000
        poll_interval_sec = poll_interval_ms / 1000
        
        print(f"[*] 等待验证邮件... (邮箱: {email}, 超时: {timeout_sec}s)")
        
        poll_count = 0
        while time.time() - start_time < timeout_sec:
            poll_count += 1
            elapsed = int(time.time() - start_time)
            print(f"[*] 轮询邮件 #{poll_count} (已等待 {elapsed}s)...")
            
            try:
                emails = self.get_emails(email)
                print(f"[*] 收到 {len(emails) if emails else 0} 封邮件")
                
                if emails and len(emails) > 0:
                    for msg in emails:
                        # 检查是否是 AWS 验证邮件
                        subject = msg.get("subject", "")
                        print(f"[*] 检查邮件: {subject[:50]}...")
                        
                        if "verification" in subject.lower() or "verify" in subject.lower() or "aws" in subject.lower() or "code" in subject.lower():
                            # 获取邮件详情
                            print(f"[*] 发现可能的验证邮件，获取详情...")
                            detail = self.get_email_detail(msg.get("id"))
                            
                            # 打印邮件详情的所有字段（调试用）
                            print(f"[DEBUG] 邮件字段: {list(detail.keys())}")
                            
                            # 尝试多种字段获取内容
                            body = ""
                            for field in ["body", "text", "html", "content", "textBody", "htmlBody", "plain", "rawBody"]:
                                if detail.get(field):
                                    body = detail.get(field)
                                    print(f"[DEBUG] 使用字段 '{field}' 获取内容，长度: {len(body)}")
                                    break
                            
                            if not body:
                                print(f"[DEBUG] 完整邮件内容: {detail}")
                            else:
                                # 打印前 500 字符用于调试
                                print(f"[DEBUG] 邮件内容预览: {body[:500]}...")
                            
                            # 提取 6 位验证码（多种模式）
                            # 模式1: 独立的 6 位数字
                            code_match = re.search(r'\b(\d{6})\b', body)
                            if code_match:
                                code = code_match.group(1)
                                print(f"[+] 获取到验证码: {code}")
                                return code
                            
                            # 模式2: 可能被 HTML 标签包裹
                            code_match = re.search(r'>(\d{6})<', body)
                            if code_match:
                                code = code_match.group(1)
                                print(f"[+] 获取到验证码 (HTML): {code}")
                                return code
                            
                            # 模式3: "code is XXXXXX" 或 "code: XXXXXX"
                            code_match = re.search(r'code[:\s]+(\d{6})', body, re.IGNORECASE)
                            if code_match:
                                code = code_match.group(1)
                                print(f"[+] 获取到验证码 (code pattern): {code}")
                                return code
                            
                            print(f"[!] 邮件中未找到 6 位验证码")
                
            except Exception as e:
                print(f"[!] 获取邮件失败: {e}")
            
            print(f"[*] {poll_interval_sec}秒后重试...")
            time.sleep(poll_interval_sec)
        
        raise TimeoutError(f"等待验证码超时 ({timeout_sec}s)")


# ==================== 页面操作函数 ====================

def find_and_fill_email(page: Page, email: str) -> bool:
    """查找并填写邮箱输入框"""
    # 优化选择器顺序，AWS Builder ID 页面使用 type="text" + placeholder 包含 @
    selectors = [
        # AWS Builder ID 特定选择器
        'input[placeholder*="username@example.com"]',  # AWS Builder ID 登录页
        'input[placeholder*="@"][type="text"]',  # 带邮箱占位符的文本框
        'input[class*="awsui_input"]',  # AWS UI 输入框
        # 通用选择器
        'input[type="email"]',
        'input[name="email"]',
        '#resolving_input',
        'input[placeholder*="@"]',
        'input[type="text"][autocomplete="on"]',
        'input[type="text"]'
    ]
    
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if locator.is_visible(timeout=3000):
                print(f"[*] 找到邮箱输入框: {selector}")
                # 移动到元素附近
                try:
                    box = locator.bounding_box()
                    if box:
                        human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
                except:
                    pass
                
                random_delay(500, 1000)
                human_type(page, selector, email)
                random_delay(500, 1000)
                
                # 尝试点击 Continue 按钮而不是按 Enter（AWS 页面更可靠）
                continue_clicked = False
                continue_selectors = [
                    'button[data-testid="test-primary-button"]',  # AWS Builder ID Continue 按钮
                    'button[type="submit"]',
                    'button:has-text("Continue")',
                ]
                for btn_selector in continue_selectors:
                    try:
                        btn = page.locator(btn_selector).first
                        if btn.is_visible(timeout=1000):
                            try:
                                box = btn.bounding_box()
                                if box:
                                    human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
                            except:
                                pass
                            random_delay(300, 600)
                            btn.click()
                            print(f"[+] 已点击 Continue 按钮")
                            continue_clicked = True
                            break
                    except:
                        continue
                
                # 如果没找到 Continue 按钮，按 Enter
                if not continue_clicked:
                    random_delay(300, 600)
                    page.keyboard.press("Enter")
                
                print(f"[+] 已输入邮箱: {email}")
                return True
        except Exception as e:
            print(f"[!] 选择器 {selector} 失败: {e}")
            continue
    
    # 尝试使用 role
    try:
        textbox = page.get_by_role("textbox").first
        if textbox.is_visible(timeout=3000):
            print("[*] 使用 role=textbox 查找邮箱输入框")
            # 移动鼠标到输入框
            try:
                box = textbox.bounding_box()
                if box:
                    human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
            except:
                pass
            
            random_delay(500, 1000)
            textbox.click()
            random_delay(500, 1000)
            
            # 逐字符输入（更像人类）
            for char in email:
                textbox.type(char, delay=random.randint(80, 200))
                if random.random() < 0.15:
                    random_delay(100, 300)
            
            random_delay(500, 1000)
            
            # 尝试点击 Continue 按钮
            try:
                continue_btn = page.locator('button[data-testid="test-primary-button"]').first
                if continue_btn.is_visible(timeout=1000):
                    continue_btn.click()
                    print(f"[+] 已输入邮箱并点击 Continue (role)")
                    return True
            except:
                pass
            
            page.keyboard.press("Enter")
            print(f"[+] 已输入邮箱 (role): {email}")
            return True
    except Exception:
        pass
    
    return False


def find_and_fill_password(page: Page, password: str) -> bool:
    """查找并填写密码输入框"""
    selectors = [
        'input[type="password"]',
        'input[name="password"]',
        '#password'
    ]
    
    # 等待密码框出现
    random_delay(1000, 2000)
    
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if locator.is_visible(timeout=5000):
                random_delay(300, 800)
                human_type(page, selector, password)
                random_delay(200, 500)
                page.keyboard.press("Enter")
                print("[+] 已输入密码")
                return True
        except Exception:
            continue
    
    return False


def find_and_fill_mfa(page: Page, mfa_secret: str) -> bool:
    """查找并填写 MFA 验证码"""
    if not HAS_PYOTP:
        print("[!] 未安装 pyotp，跳过 MFA")
        return False
    
    selectors = [
        'input[name="mfaCode"]',
        'input[name="otp"]',
        'input[type="tel"]',
        'input[placeholder*="6"]'
    ]
    
    random_delay(1000, 2000)
    
    for selector in selectors:
        try:
            locator = page.locator(selector).first
            if locator.is_visible(timeout=5000):
                totp = pyotp.TOTP(mfa_secret)
                code = totp.now()
                
                random_delay(300, 800)
                human_type(page, selector, code)
                random_delay(200, 500)
                page.keyboard.press("Enter")
                print(f"[+] 已输入 MFA 验证码")
                return True
        except Exception:
            continue
    
    return False


def detect_registration_page(page: Page) -> bool:
    """检测是否进入了注册页面"""
    url = page.url
    if "signup" in url or "register" in url:
        return True
    
    # 检查是否有姓名输入框
    name_selectors = [
        'input[placeholder*="Maria"]',
        'input[placeholder*="name" i]',
        'input[name="fullName"]',
        'input[name="displayName"]'
    ]
    
    for selector in name_selectors:
        try:
            if page.locator(selector).first.is_visible(timeout=1000):
                return True
        except:
            pass
    
    return False


def detect_form_error(page: Page) -> Optional[str]:
    """
    检测页面上是否存在表单错误提示
    
    AWS 错误提示特征：
    1. data-analytics-alert="error" 属性
    2. data-testid 包含 "error-alert"
    3. 错误文本包含 "Sorry, there was an error" 或类似内容
    
    Returns:
        错误信息文本，如果没有错误则返回 None
    """
    error_selectors = [
        '[data-analytics-alert="error"]',
        '[data-testid*="error-alert"]',
        '[data-testid*="error"]',
        '.awsui_type-error',
        '[class*="error"][class*="alert"]',
    ]
    
    for selector in error_selectors:
        try:
            error_element = page.locator(selector).first
            if error_element.is_visible(timeout=1000):
                # 尝试获取错误内容
                try:
                    # 查找错误内容元素
                    content_selectors = [
                        '[class*="content"]',
                        '[class*="message"]',
                        'div',
                    ]
                    for content_sel in content_selectors:
                        try:
                            content = error_element.locator(content_sel).first
                            text = content.text_content() or ""
                            if text and len(text) > 5:
                                print(f"[!] 检测到错误提示: {text[:100]}")
                                return text
                        except:
                            continue
                    
                    # 如果找不到内容元素，直接获取整个错误元素的文本
                    text = error_element.text_content() or ""
                    if text:
                        print(f"[!] 检测到错误提示: {text[:100]}")
                        return text
                except:
                    return "检测到未知错误"
        except:
            continue
    
    return None


def fill_name_step(page: Page, display_name: str) -> bool:
    """填写姓名步骤（带错误检测和重试）"""
    print(f"[*] 填写姓名: {display_name}")
    
    # 等待页面加载
    wait_for_page_ready(page, 15000)
    random_delay(2000, 3000)
    
    # 处理 Cookie 同意弹窗（如果存在）
    handle_cookie_consent(page)
    random_delay(500, 1000)
    
    name_selectors = [
        'input[placeholder*="Maria"]',
        'input[placeholder*="name" i]',
        'input[name="fullName"]',
        'input[name="displayName"]',
        'input[autocomplete="name"]',
        'input[type="text"]',  # 备用：页面上可能只有一个文本输入框
    ]
    
    # 最大重试次数（包括错误后重试）
    max_submit_attempts = 5
    
    # 多次尝试查找姓名输入框（页面可能加载较慢）
    max_find_attempts = 3
    for find_attempt in range(max_find_attempts):
        print(f"[*] 尝试查找姓名输入框 ({find_attempt + 1}/{max_find_attempts})...")
        
        for selector in name_selectors:
            try:
                locator = page.locator(selector).first
                if locator.is_visible(timeout=5000):
                    # 检查输入框是否已有内容
                    current_value = locator.input_value() or ""
                    
                    # 模拟人类操作
                    try:
                        box = locator.bounding_box()
                        if box:
                            human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
                    except:
                        pass
                    
                    random_delay(500, 1000)
                    locator.click()
                    random_delay(300, 600)
                    
                    # 如果输入框为空或内容不是我们要的，则填写
                    if not current_value or current_value != display_name:
                        # 清空现有内容
                        if current_value:
                            locator.fill("")
                            random_delay(200, 400)
                        
                        # 逐字符输入
                        for char in display_name:
                            locator.type(char, delay=random.randint(80, 180))
                            if random.random() < 0.1:
                                random_delay(100, 300)
                    
                    print(f"[+] 已填写姓名: {display_name}")
                    
                    # 提交并检测错误，带重试
                    for submit_attempt in range(max_submit_attempts):
                        print(f"[*] 提交姓名表单 (尝试 {submit_attempt + 1}/{max_submit_attempts})...")
                        
                        # 点击继续按钮
                        random_delay(1000, 2000)
                        if click_continue_button(page):
                            print("[+] 已点击继续按钮")
                        else:
                            print("[!] 未能点击继续按钮，尝试按 Enter")
                            page.keyboard.press("Enter")
                        
                        # 等待页面响应
                        random_delay(2000, 3000)
                        wait_for_page_ready(page, 10000)
                        
                        # 检测是否有错误
                        error_msg = detect_form_error(page)
                        if error_msg:
                            print(f"[!] 表单提交失败: {error_msg[:50]}...")
                            
                            # 关闭错误提示（如果有关闭按钮）
                            try:
                                dismiss_selectors = [
                                    'button[aria-label="Close alert"]',
                                    'button[class*="dismiss"]',
                                    '[data-testid*="dismiss"]',
                                ]
                                for dismiss_sel in dismiss_selectors:
                                    try:
                                        dismiss_btn = page.locator(dismiss_sel).first
                                        if dismiss_btn.is_visible(timeout=1000):
                                            dismiss_btn.click()
                                            print("[*] 已关闭错误提示")
                                            random_delay(500, 1000)
                                            break
                                    except:
                                        continue
                            except:
                                pass
                            
                            if submit_attempt < max_submit_attempts - 1:
                                print(f"[*] 等待后重试提交...")
                                random_delay(2000, 4000)
                                continue
                            else:
                                print(f"[!] 姓名提交在 {max_submit_attempts} 次尝试后仍失败")
                                return False
                        else:
                            # 没有错误，检查是否成功进入下一步
                            # 检查 URL 是否变化或页面内容是否变化
                            print("[+] 姓名步骤完成")
                            return True
                    
                    return False
                    
            except Exception as e:
                continue
        
        # 本次尝试未找到，等待后重试
        if find_attempt < max_find_attempts - 1:
            print(f"[*] 未找到姓名输入框，等待后重试...")
            random_delay(3000, 5000)
            wait_for_page_ready(page, 10000)
    
    print("[!] 未找到姓名输入框")
    return False


def print_page_structure(page: Page) -> None:
    """打印页面结构用于调试"""
    print("[DEBUG] ========== 页面结构分析 ==========")
    print(f"[DEBUG] 当前 URL: {page.url}")
    
    # 打印所有输入框
    try:
        inputs = page.locator('input').all()
        print(f"[DEBUG] 找到 {len(inputs)} 个输入框:")
        for i, inp in enumerate(inputs):
            try:
                input_type = inp.get_attribute('type') or 'text'
                input_name = inp.get_attribute('name') or ''
                input_id = inp.get_attribute('id') or ''
                placeholder = inp.get_attribute('placeholder') or ''
                testid = inp.get_attribute('data-testid') or ''
                visible = inp.is_visible()
                print(f"[DEBUG]   [{i}] type={input_type}, name={input_name}, id={input_id}, placeholder={placeholder[:30]}, data-testid={testid}, visible={visible}")
            except:
                pass
    except Exception as e:
        print(f"[DEBUG] 获取输入框失败: {e}")
    
    # 打印所有按钮
    try:
        buttons = page.locator('button').all()
        print(f"[DEBUG] 找到 {len(buttons)} 个按钮:")
        for i, btn in enumerate(buttons):
            try:
                text = (btn.text_content() or '')[:30]
                testid = btn.get_attribute('data-testid') or ''
                btn_type = btn.get_attribute('type') or ''
                visible = btn.is_visible()
                print(f"[DEBUG]   [{i}] text={text}, type={btn_type}, data-testid={testid}, visible={visible}")
            except:
                pass
    except Exception as e:
        print(f"[DEBUG] 获取按钮失败: {e}")
    
    print("[DEBUG] ========== 结构分析完成 ==========")


def detect_password_page(page: Page) -> bool:
    """
    检测是否在密码设置页面
    基于多种特征综合判断：
    1. 页面标题包含 "password"
    2. 存在密码输入框
    3. 存在特定的 placeholder 文本
    """
    # 方法1: 检查页面标题/heading
    try:
        headings = page.locator('h1').all()
        for heading in headings:
            text = (heading.text_content() or "").lower()
            if "password" in text or "create your password" in text.lower():
                print(f"[*] 检测到密码页面标题: {text[:50]}")
                return True
    except:
        pass
    
    # 方法2: 检查是否有带特定 placeholder 的密码框
    password_placeholders = [
        'input[placeholder="Enter password"]',
        'input[placeholder="Re-enter password"]',
        'input[placeholder*="password" i]',
    ]
    for selector in password_placeholders:
        try:
            if page.locator(selector).count() > 0:
                print(f"[*] 检测到密码输入框: {selector}")
                return True
        except:
            pass
    
    # 方法3: 检查是否有 type="password" 的输入框
    try:
        pwd_count = page.locator('input[type="password"]').count()
        if pwd_count > 0:
            print(f"[*] 检测到 {pwd_count} 个 password 类型输入框")
            return True
    except:
        pass
    
    # 方法4: 检查页面内容
    try:
        page_content = page.content().lower()
        if "create your password" in page_content or "confirm password" in page_content:
            print("[*] 检测到密码页面内容关键词")
            return True
    except:
        pass
    
    return False


def fill_password_step(page: Page, password: str) -> bool:
    """填写密码步骤（带错误检测和重试）"""
    print("[*] 填写密码...")
    
    # 等待页面加载
    wait_for_page_ready(page, 10000)
    random_delay(2000, 3000)
    
    # 打印页面结构用于调试
    print_page_structure(page)
    
    # 最大提交重试次数
    max_submit_attempts = 5
    
    # 多种选择器查找密码框（按优先级排序）
    password_selectors = [
        # AWS Builder ID 特定选择器（基于实际页面）
        'input[placeholder="Enter password"]',
        'input[placeholder="Re-enter password"]',
        # 通用选择器
        'input[type="password"]',
        'input[placeholder*="password" i]',
        'input[autocomplete="new-password"]',
        'input[autocomplete="current-password"]',
    ]
    
    # 收集所有密码输入框
    password_inputs = []
    
    # 优先使用精确选择器
    enter_pwd = page.locator('input[placeholder="Enter password"]')
    confirm_pwd = page.locator('input[placeholder="Re-enter password"]')
    
    if enter_pwd.count() > 0 and confirm_pwd.count() > 0:
        # AWS Builder ID 页面：有明确的 placeholder
        print("[*] 使用 AWS Builder ID 特定选择器")
        password_inputs = [enter_pwd.first, confirm_pwd.first]
    else:
        # 回退到通用选择器
        password_inputs = page.locator('input[type="password"]').all()
    
    def fill_password_inputs(inputs: list, pwd: str) -> bool:
        """填写密码到输入框"""
        if len(inputs) >= 2:
            print(f"[*] 找到 {len(inputs)} 个密码框")
            # 有确认密码框
            try:
                box = inputs[0].bounding_box()
                if box:
                    human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
            except:
                pass
            
            random_delay(500, 1000)
            inputs[0].click()
            random_delay(300, 600)
            
            # 清空并逐字符输入密码
            inputs[0].fill("")
            random_delay(200, 400)
            for char in pwd:
                inputs[0].type(char, delay=random.randint(60, 150))
            
            random_delay(500, 1000)
            
            # 确认密码
            try:
                box = inputs[1].bounding_box()
                if box:
                    human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
            except:
                pass
            
            random_delay(300, 600)
            inputs[1].click()
            random_delay(300, 600)
            
            # 清空并逐字符输入确认密码
            inputs[1].fill("")
            random_delay(200, 400)
            for char in pwd:
                inputs[1].type(char, delay=random.randint(60, 150))
            
            print("[+] 已填写密码和确认密码")
            return True
            
        elif len(inputs) == 1:
            try:
                box = inputs[0].bounding_box()
                if box:
                    human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
            except:
                pass
            
            random_delay(500, 1000)
            inputs[0].click()
            random_delay(300, 600)
            
            # 清空并逐字符输入密码
            inputs[0].fill("")
            random_delay(200, 400)
            for char in pwd:
                inputs[0].type(char, delay=random.randint(60, 150))
            
            print("[+] 已填写密码")
            return True
        else:
            print("[!] 未找到密码输入框")
            return False
    
    def click_password_submit_button() -> bool:
        """点击密码页面的提交按钮"""
        # 先尝试密码页面特定的按钮选择器
        password_button_selectors = [
            'button[data-testid="test-primary-button"]',  # 密码页面的继续按钮
            'button[data-testid="password-creation-submit-button"]',
            'button[data-testid="set-password-button"]',
            'button[data-testid="create-password-button"]',
            'button[data-testid*="primary-button"]',  # 匹配 primary-button 后缀
        ]
        
        for selector in password_button_selectors:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1000):
                    try:
                        box = btn.bounding_box()
                        if box:
                            human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
                    except:
                        pass
                    random_delay(300, 600)
                    btn.click()
                    print(f"[+] 已点击密码页面按钮: {selector}")
                    return True
            except:
                continue
        
        # 如果特定选择器没找到，使用通用的 click_continue_button
        if click_continue_button(page):
            return True
        
        # 如果还是没点击成功，尝试按 Enter
        print("[!] 未能点击继续按钮，尝试按 Enter 键...")
        page.keyboard.press("Enter")
        return True
    
    # 首次填写密码
    if not fill_password_inputs(password_inputs, password):
        return False
    
    # 提交并检测错误，带重试
    for submit_attempt in range(max_submit_attempts):
        print(f"[*] 提交密码表单 (尝试 {submit_attempt + 1}/{max_submit_attempts})...")
        
        # 提交 - 点击继续按钮
        random_delay(800, 1500)
        click_password_submit_button()
        
        # 等待页面响应
        random_delay(2000, 3000)
        wait_for_page_ready(page, 10000)
        
        # 检测是否有错误
        error_msg = detect_form_error(page)
        if error_msg:
            print(f"[!] 密码表单提交失败: {error_msg[:50]}...")
            
            # 关闭错误提示（如果有关闭按钮）
            try:
                dismiss_selectors = [
                    'button[aria-label="Close alert"]',
                    'button[class*="dismiss"]',
                    '[data-testid*="dismiss"]',
                ]
                for dismiss_sel in dismiss_selectors:
                    try:
                        dismiss_btn = page.locator(dismiss_sel).first
                        if dismiss_btn.is_visible(timeout=1000):
                            dismiss_btn.click()
                            print("[*] 已关闭错误提示")
                            random_delay(500, 1000)
                            break
                    except:
                        continue
            except:
                pass
            
            if submit_attempt < max_submit_attempts - 1:
                print(f"[*] 等待后重试提交...")
                random_delay(2000, 4000)
                
                # 重新获取密码输入框（页面可能已刷新）
                enter_pwd = page.locator('input[placeholder="Enter password"]')
                confirm_pwd = page.locator('input[placeholder="Re-enter password"]')
                
                if enter_pwd.count() > 0 and confirm_pwd.count() > 0:
                    password_inputs = [enter_pwd.first, confirm_pwd.first]
                else:
                    password_inputs = page.locator('input[type="password"]').all()
                
                # 检查密码框是否被清空，如果是则重新填写
                try:
                    if password_inputs and len(password_inputs) > 0:
                        current_value = password_inputs[0].input_value() or ""
                        if not current_value:
                            print("[*] 密码框已清空，重新填写...")
                            fill_password_inputs(password_inputs, password)
                except:
                    pass
                
                continue
            else:
                print(f"[!] 密码提交在 {max_submit_attempts} 次尝试后仍失败")
                return False
        else:
            # 没有错误，检查是否成功进入下一步
            print("[+] 密码步骤完成")
            return True
    
    return False


def fill_registration_form(page: Page, display_name: str, password: str) -> bool:
    """
    填写注册表单
    AWS 注册流程：邮箱 → 姓名 → 验证码 → 密码
    这个函数只处理姓名步骤，密码在验证码之后填写
    """
    return fill_name_step(page, display_name)


def fill_verification_code(page: Page, code: str) -> bool:
    """填写验证码（带错误检测和重试，逻辑与姓名界面一致）"""
    print(f"[*] 填写验证码: {code}")
    
    # 等待页面加载
    wait_for_page_ready(page, 10000)
    random_delay(1000, 2000)
    
    # 处理 Cookie 同意弹窗（如果存在）
    handle_cookie_consent(page)
    random_delay(500, 1000)
    
    # 最大提交重试次数
    max_submit_attempts = 5
    
    code_selectors = [
        'input[name="code"]',
        'input[name="verificationCode"]',
        'input[name="confirmationCode"]',
        'input[placeholder*="6"]',
        'input[placeholder*="code" i]',
        'input[placeholder*="验证" i]',
        'input[type="tel"]',
        'input[maxlength="6"]',
        'input[data-testid*="code"]',
        'input[data-testid*="verification"]',
    ]
    
    # 查找并填写验证码输入框
    code_filled = False
    for selector in code_selectors:
        try:
            locator = page.locator(selector).first
            if locator.is_visible(timeout=3000):
                # 移动鼠标到输入框
                try:
                    box = locator.bounding_box()
                    if box:
                        human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
                except:
                    pass
                
                random_delay(500, 1000)
                locator.click()
                random_delay(300, 600)
                
                # 逐字符输入验证码
                for char in code:
                    locator.type(char, delay=random.randint(100, 200))
                
                print(f"[+] 已填写验证码: {code}")
                code_filled = True
                break
        except Exception as e:
            continue
    
    # 尝试使用 role 查找
    if not code_filled:
        try:
            textbox = page.get_by_role("textbox").first
            if textbox.is_visible(timeout=3000):
                print("[*] 使用 role=textbox 查找输入框")
                textbox.click()
                random_delay(300, 600)
                for char in code:
                    textbox.type(char, delay=random.randint(100, 200))
                print(f"[+] 已填写验证码 (role): {code}")
                code_filled = True
        except:
            pass
    
    if not code_filled:
        print("[!] 未找到验证码输入框")
        return False
    
    # 提交并检测错误，带重试（与姓名界面逻辑一致）
    for submit_attempt in range(max_submit_attempts):
        print(f"[*] 提交验证码表单 (尝试 {submit_attempt + 1}/{max_submit_attempts})...")
        
        # 点击继续按钮
        random_delay(1000, 2000)
        if click_continue_button(page):
            print("[+] 已点击继续按钮")
        else:
            print("[!] 未能点击继续按钮，尝试按 Enter")
            page.keyboard.press("Enter")
        
        # 等待页面响应
        random_delay(2000, 3000)
        wait_for_page_ready(page, 10000)
        
        # 检测是否有错误
        error_msg = detect_form_error(page)
        if error_msg:
            print(f"[!] 验证码表单提交失败: {error_msg[:50]}...")
            
            # 关闭错误提示（如果有关闭按钮）
            try:
                dismiss_selectors = [
                    'button[aria-label="Close alert"]',
                    'button[class*="dismiss"]',
                    '[data-testid*="dismiss"]',
                ]
                for dismiss_sel in dismiss_selectors:
                    try:
                        dismiss_btn = page.locator(dismiss_sel).first
                        if dismiss_btn.is_visible(timeout=1000):
                            dismiss_btn.click()
                            print("[*] 已关闭错误提示")
                            random_delay(500, 1000)
                            break
                    except:
                        continue
            except:
                pass
            
            if submit_attempt < max_submit_attempts - 1:
                print(f"[*] 等待后重试提交...")
                random_delay(2000, 4000)
                continue
            else:
                print(f"[!] 验证码提交在 {max_submit_attempts} 次尝试后仍失败")
                return False
        else:
            # 没有错误，验证码步骤完成
            print("[+] 验证码步骤完成")
            return True
    
    return False


def click_continue_button(page: Page) -> bool:
    """点击继续/下一步/提交按钮"""
    print("[*] 查找继续按钮...")
    
    # 方法1: 通过 data-testid 查找（AWS 常用）
    testid_selectors = [
        'button[data-testid="email-verification-verify-button"]',  # 验证码页面的继续按钮
        'button[data-testid="signup-next-button"]',
        'button[data-testid="continue-button"]',
        'button[data-testid="submit-button"]',
        '[data-testid="signup-next-button"]',
        '[data-testid*="verify-button"]',  # 匹配 verify-button 后缀
        '[data-testid*="continue"]',
        '[data-testid*="next"]',
        '[data-testid*="submit"]',
    ]
    
    for selector in testid_selectors:
        try:
            btn = page.locator(selector).first
            if btn.is_visible(timeout=1000):
                # 移动鼠标到按钮
                try:
                    box = btn.bounding_box()
                    if box:
                        human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
                except:
                    pass
                random_delay(300, 600)
                btn.click()
                print(f"[+] 已点击按钮 (data-testid): {selector}")
                return True
        except:
            continue
    
    # 方法2: 通过按钮文字查找
    button_texts = ["Continue", "继续", "Next", "下一步", "Submit", "提交", "Verify", "验证", "Create"]
    
    for text in button_texts:
        try:
            button = page.get_by_role("button", name=text)
            if button.is_visible(timeout=1000):
                try:
                    box = button.bounding_box()
                    if box:
                        human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
                except:
                    pass
                random_delay(300, 600)
                button.click()
                print(f"[+] 已点击按钮: {text}")
                return True
        except:
            continue
    
    # 方法3: 通过 CSS 选择器查找
    css_selectors = [
        'button[type="submit"]',
        'button.awsui-button-variant-primary',
        'button.primary',
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'input[type="submit"]',
    ]
    
    for selector in css_selectors:
        try:
            btn = page.locator(selector).first
            if btn.is_visible(timeout=1000):
                try:
                    box = btn.bounding_box()
                    if box:
                        human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
                except:
                    pass
                random_delay(300, 600)
                btn.click()
                print(f"[+] 已点击按钮 (CSS): {selector}")
                return True
        except:
            continue
    
    # 方法4: 查找所有按钮并点击第一个可见的主要按钮
    try:
        buttons = page.locator('button').all()
        print(f"[*] 找到 {len(buttons)} 个按钮")
        for btn in buttons:
            try:
                if btn.is_visible(timeout=500):
                    text = btn.text_content() or ""
                    # 跳过取消、关闭等按钮
                    if any(skip in text.lower() for skip in ['cancel', 'close', 'back', '取消', '关闭', '返回']):
                        continue
                    print(f"[*] 尝试点击按钮: {text[:30]}...")
                    try:
                        box = btn.bounding_box()
                        if box:
                            human_mouse_move(page, int(box['x'] + box['width']/2), int(box['y'] + box['height']/2))
                    except:
                        pass
                    random_delay(300, 600)
                    btn.click()
                    print(f"[+] 已点击按钮: {text[:30]}")
                    return True
            except:
                continue
    except Exception as e:
        print(f"[!] 查找按钮时出错: {e}")
    
    print("[!] 未找到可点击的继续按钮")
    return False


def click_allow_button(page: Page) -> bool:
    """点击授权允许按钮（包括 Authorization requested 和 Allow access 页面）"""
    
    random_delay(1000, 2000)
    
    def click_by_selector(selector: str) -> bool:
        frames = get_all_frames(page)
        for frame in frames:
            try:
                locator = frame.locator(selector)
                if locator.count() == 0:
                    continue
            except Exception:
                continue
            
            candidate = locator.first
            if not locator_is_visible(candidate):
                continue
            
            if human_like_click(page, candidate, f"授权按钮 {selector}"):
                print(f"[+] 已点击授权按钮 (selector): {selector}")
                return True
        return False
    
    def click_by_role(role: str, name: str) -> bool:
        frames = get_all_frames(page)
        for frame in frames:
            try:
                locator = frame.get_by_role(role, name=name)
                if locator.count() == 0:
                    continue
            except Exception:
                continue
            
            candidate = locator.first
            if not locator_is_visible(candidate):
                continue
            
            if human_like_click(page, candidate, f"{name} ({role})"):
                print(f"[+] 已点击授权按钮: {name}")
                return True
        return False
    
    # 方法1: 通过特定的 ID 或 data-analytics/data-testid 属性查找
    specific_selectors = [
        'button[data-testid="allow-access-button"]',
        'button[data-testid="allow-access-primary-button"]',
        'button[data-analytics="consent-allow-access"]',
        'button[data-analytics="accept-user-code"]',
        'button[data-testid="confirm-button"]',
        'button[data-testid="allow-button"]',
        'button[data-testid*="allow-access"]',
        'button#cli_verification_btn',
        'button[id*="allow"]',
        'button[name*="allow"]',
        'button[aria-label*="Allow"]',
        'button[aria-label*="allow"]',
        'button[data-action*="allow"]',
        'button.awsui-button-variant-primary:has-text("Allow access")',
        'button.awsui-button-variant-primary:has-text("Allow")',
        '[data-testid="allow-access-button"] button',
        '[data-testid*="allow-access"] button',
        'input[type="submit"][value*="Allow"]',
        'input[type="submit"][value*="允许"]',
        'input[type="submit"][aria-label*="Allow"]',
    ]
    
    for selector in specific_selectors:
        if click_by_selector(selector):
            return True
    
    # 方法2: 通过按钮文字查找（button + link）
    button_texts = [
        "Allow access",
        "Allow Access",
        "Allow",
        "Allow device access",
        "Confirm and continue",
        "Confirm & continue",
        "Confirm",
        "Authorize",
        "Authorize device",
        "Continue",
        "Accept",
        "允许",
        "授权",
        "确认",
        "继续",
        "同意",
    ]
    
    for text in button_texts:
        if click_by_role("button", text):
            return True
        if click_by_role("link", text):
            return True
    
    # 方法3: 通过通用 CSS 选择器查找
    css_selectors = [
        'button[type="submit"]',
        'button.awsui-button-variant-primary',
        '[role="button"][data-testid*="allow"]',
        '[role="button"][aria-label*="Allow"]',
        '[data-testid*="allow"]',
        'input[type="submit"]',
        'button:has-text("Continue")',
        'button:has-text("Next")',
    ]
    
    for selector in css_selectors:
        if click_by_selector(selector):
            return True
    
    # 方法4: 查找所有按钮/伪按钮，匹配包含授权关键词的元素
    allow_keywords = ['allow', 'allow access', 'authorize', 'confirm', 'continue', 'accept', '允许', '授权', '确认', '继续', '同意']
    skip_keywords = ['cancel', 'close', 'back', 'deny', 'reject', 'decline', '取消', '关闭', '返回', '拒绝']
    
    try:
        frames = get_all_frames(page)
        for frame in frames:
            locator_groups = [
                frame.locator('button'),
                frame.locator('[role="button"]'),
                frame.locator('input[type="submit"]'),
            ]
            
            for group in locator_groups:
                try:
                    elements = group.all()
                except Exception:
                    continue
                
                for element in elements:
                    try:
                        if not locator_is_visible(element):
                            continue
                        
                        text = (element.text_content() or "").strip()
                        value_attr = (element.get_attribute("value") or "").strip()
                        aria_label = (element.get_attribute("aria-label") or "").strip()
                        combined_text = " ".join(part for part in [text, value_attr, aria_label] if part)
                        
                        if not combined_text:
                            continue
                        
                        lower_text = combined_text.lower()
                        if any(skip in lower_text for skip in skip_keywords):
                            continue
                        
                        if any(keyword in lower_text for keyword in allow_keywords):
                            if human_like_click(page, element, f"授权按钮 {combined_text[:30]}"):
                                print(f"[+] 已点击授权按钮: {combined_text[:30]}")
                                return True
                    except Exception:
                        continue
    except Exception as e:
        print(f"[!] 查找授权按钮时出错: {e}")
    
    return False


def complete_authorization_flow(page: Page, max_attempts: int = 10) -> bool:
    """
    完成完整的授权流程（可能包含多个授权页面）
    
    AWS 授权流程可能包含：
    1. Authorization requested 页面 → "Confirm and continue"
    2. Allow access 页面 → "Allow access"
    3. 可能还有其他授权页面
    
    Args:
        page: 页面对象
        max_attempts: 最大尝试次数
    
    Returns:
        是否成功到达成功页面
    """
    print("[*] 开始完成授权流程...")
    
    for attempt in range(max_attempts):
        # 检查是否已经到达成功页面（综合检查 URL 和页面内容）
        if check_success_page(page):
            print(f"[+] 授权成功！当前 URL: {page.url}")
            return True
        
        current_url = page.url
        print(f"[*] 授权尝试 {attempt + 1}/{max_attempts}，当前 URL: {current_url[:80]}...")
        
        # 等待页面加载（增加等待时间）
        wait_for_page_ready(page, 15000)
        random_delay(3000, 5000)
        
        # 再次检查是否成功（页面加载完成后）
        if check_success_page(page):
            print(f"[+] 授权成功！当前 URL: {page.url}")
            return True
        
        # 检查并关闭 Cookie 弹窗（可能会挡住授权按钮）
        handle_cookie_consent(page)
        random_delay(2000, 3000)
        
        # 尝试点击授权按钮
        if click_allow_button(page):
            print(f"[+] 第 {attempt + 1} 次点击授权按钮成功")
            
            # 等待页面跳转到成功页面（多次检测）
            url_before = page.url
            for wait_attempt in range(10):  # 最多等待 30 秒
                random_delay(2000, 3000)
                wait_for_page_ready(page, 5000)
                
                current_url = page.url
                print(f"[*] 等待跳转 ({wait_attempt + 1}/10)，当前 URL: {current_url[:60]}...")
                
                # 检查是否到达成功页面（综合检查 URL 和页面内容）
                if check_success_page(page):
                    print(f"[+] 授权成功！当前 URL: {current_url}")
                    return True
                
                # 如果在等待过程中出现新的授权页面，立即点击
                if click_allow_button(page):
                    print("[+] 等待跳转时检测到新的授权页面，已再次点击")
                    url_before = page.url
                    continue
                
                # 如果 URL 变化了但还不是成功页面，继续等待
                if current_url != url_before:
                    url_before = current_url
                    continue
            
        else:
            print(f"[!] 第 {attempt + 1} 次未找到授权按钮")
            # 可能页面还在加载，等待更长时间
            random_delay(5000, 8000)
        
        # 再次检查是否成功（综合检查）
        if check_success_page(page):
            print(f"[+] 授权成功！当前 URL: {page.url}")
            return True
    
    print(f"[!] 授权流程在 {max_attempts} 次尝试后仍未完成")
    return False


def check_for_errors(page: Page, strict: bool = False) -> Optional[str]:
    """
    检查页面是否有错误信息
    
    Args:
        page: 页面对象
        strict: 是否严格模式（严格模式下检测更多关键词）
    """
    # 严重错误（总是检测）
    critical_errors = [
        ("BLOCKED", "TES"),
        ("blocked", "request"),
        ("access", "denied"),
    ]
    
    # 轻微警告（只在严格模式下检测）
    warnings = [
        ("captcha", "verify"),
        ("robot", "check"),
        ("error", "occurred"),
    ]
    
    page_text = page.content().lower()
    
    # 检查严重错误
    for keywords in critical_errors:
        if all(kw in page_text for kw in keywords):
            return f"检测到严重错误: {keywords}"
    
    # 严格模式下检查警告
    if strict:
        for keywords in warnings:
            if all(kw in page_text for kw in keywords):
                return f"检测到警告: {keywords}"
    
    return None


def check_for_captcha(page: Page) -> bool:
    """检查是否出现了 CAPTCHA"""
    captcha_indicators = [
        "iframe[src*='captcha']",
        "iframe[src*='recaptcha']",
        "#captcha",
        ".captcha",
        "[data-callback*='captcha']"
    ]
    
    for selector in captcha_indicators:
        try:
            if page.locator(selector).count() > 0:
                return True
        except:
            pass
    
    return False


def handle_cookie_consent(page: Page) -> bool:
    """
    处理 AWS Cookie 同意弹窗
    如果存在 cookie 弹窗，点击 Accept 按钮
    
    Returns:
        bool: 是否成功处理了 cookie 弹窗
    """
    print("[*] 检查是否存在 Cookie 同意弹窗...")
    
    # AWS Cookie 同意弹窗的 Accept 按钮选择器
    # HTML 结构:
    # <div id="awsccc-sb-ux-c">
    #   <div data-id="awsccc-cb" style="display: block;">  <-- 实际弹窗容器
    #     <div id="awsccc-cb-c" ...>
    #       <div id="awsccc-cb-buttons">
    #         <button data-id="awsccc-cb-btn-accept" aria-label="Accept all cookies" class="awsccc-u-btn awsccc-u-btn-primary">
    #           <span>Accept</span>
    #         </button>
    cookie_selectors = [
        'button[data-id="awsccc-cb-btn-accept"]',  # AWS 标准 Accept 按钮（精确匹配）
        '#awsccc-cb-buttons button.awsccc-u-btn-primary',  # 按钮容器内的主按钮
        'button[aria-label="Accept all cookies"]',  # 通过 aria-label 匹配
        '[data-id="awsccc-cb"] button.awsccc-u-btn-primary',  # 弹窗容器内的主按钮
    ]
    
    for selector in cookie_selectors:
        try:
            btn = page.locator(selector).first
            
            # 检查元素数量
            count = page.locator(selector).count()
            if count == 0:
                continue
            
            # 检查元素是否可见（增加超时时间）
            try:
                is_visible = btn.is_visible(timeout=2000)
            except:
                is_visible = False
            
            if not is_visible:
                # 即使 is_visible 返回 false，也尝试检查元素是否存在于 DOM 中
                # 因为某些情况下 Playwright 的可见性判断可能不准确
                try:
                    box = btn.bounding_box()
                    if box and box['width'] > 0 and box['height'] > 0:
                        is_visible = True
                        print(f"[*] 按钮存在但 is_visible=false，通过 bounding_box 确认可见")
                except:
                    continue
            
            if not is_visible:
                continue
            
            print(f"[*] 发现 Cookie Accept 按钮: {selector}")
            
            if not human_like_click(page, btn, "Cookie Accept 按钮"):
                print("[!] Cookie Accept 按钮点击失败")
                continue
            
            print("[+] 已点击 Cookie Accept 按钮")
            
            # 等待弹窗消失
            random_delay(500, 1000)
            try:
                page.wait_for_selector('[data-id="awsccc-cb"]', state='hidden', timeout=3000)
                print("[+] Cookie 弹窗已关闭")
            except:
                print("[*] Cookie 弹窗可能已关闭（超时）")
            
            return True
                    
        except Exception as e:
            continue
    
    print("[*] 未发现 Cookie 弹窗或按钮")
    return False


def check_success_page(page: Page) -> bool:
    """
    检查是否到达成功页面（只通过页面内容判断，不检查 URL）
    
    AWS 授权成功页面特征：
    1. 页面显示 "Request approved"
    2. 页面显示 "You can close this window"
    3. 存在 data-testid="consent-success-component" 元素
    4. 存在 data-analytics-alert="success" 成功提示框
    
    注意：不能通过 URL 判断，因为 /device?user_code= 页面可能还需要点击 Allow access
    """
    # 检查页面内容是否包含成功指示符
    try:
        # 方法1: 检查成功组件是否存在（最可靠）
        success_component = page.locator('[data-testid="consent-success-component"]')
        if success_component.count() > 0 and success_component.first.is_visible(timeout=1000):
            print("[*] 检测到成功组件 (consent-success-component)")
            return True
    except:
        pass
    
    try:
        # 方法2: 检查成功提示框
        success_alert = page.locator('[data-analytics-alert="success"]')
        if success_alert.count() > 0 and success_alert.first.is_visible(timeout=1000):
            print("[*] 检测到成功提示框")
            return True
    except:
        pass
    
    try:
        # 方法3: 检查页面文本内容
        page_content = page.content().lower()
        success_texts = [
            "request approved",
            "you can close this window",
        ]
        # 需要同时包含这两个文本才算成功（更严格）
        if all(text in page_content for text in success_texts):
            print("[*] 检测到成功文本内容")
            return True
    except:
        pass
    
    return False


# ==================== 主流程函数 ====================

def login_with_camoufox(
    verification_url: str,
    credentials: Credentials,
    headless: bool = False,
    proxy: Optional[str] = None,
    timeout_ms: int = 60000
) -> LoginResult:
    """
    使用 Camoufox 完成 Amazon 设备授权登录。
    """
    print(f"[*] 启动 Camoufox 浏览器（登录模式）...")
    print(f"[*] 验证链接: {verification_url}")
    
    config = {
        "headless": headless,
        "geoip": True,  # 启用地理位置伪装
        "humanize": True,  # 启用人类化鼠标移动
        "window": (1280, 800),  # 窗口大小（元组格式）
        "locale": "en-US",  # 使用英文界面避免乱码
    }
    if proxy:
        # 代理格式: http://user:pass@host:port 或 http://host:port
        config["proxy"] = {"server": proxy}
    
    try:
        with Camoufox(**config) as browser:
            page = browser.new_page()
            page.set_default_timeout(timeout_ms)
            
            print("[*] 正在打开验证链接...")
            page.goto(verification_url, wait_until="domcontentloaded")
            random_delay(2000, 4000)
            
            # 处理 Cookie 同意弹窗（如果存在）
            handle_cookie_consent(page)
            random_delay(500, 1000)
            
            error = check_for_errors(page, strict=False)
            if error:
                return LoginResult(False, f"页面加载后检测到错误: {error}", "BLOCKED")
            
            # 输入邮箱
            print("[*] 正在输入邮箱...")
            if not find_and_fill_email(page, credentials.email):
                return LoginResult(False, "未找到邮箱输入框", "EMAIL_INPUT_NOT_FOUND")
            
            random_delay(2000, 4000)
            
            error = check_for_errors(page, strict=False)
            if error:
                return LoginResult(False, f"输入邮箱后检测到错误: {error}", "BLOCKED")
            
            # 处理 Cookie 同意弹窗（密码页面可能也会出现）
            handle_cookie_consent(page)
            random_delay(500, 1000)
            
            # 输入密码
            print("[*] 正在输入密码...")
            if not find_and_fill_password(page, credentials.password):
                return LoginResult(False, "未找到密码输入框", "PASSWORD_INPUT_NOT_FOUND")
            
            random_delay(2000, 4000)
            
            # MFA
            if credentials.mfa_secret:
                print("[*] 检查 MFA...")
                find_and_fill_mfa(page, credentials.mfa_secret)
                random_delay(2000, 4000)
            
            # 完成完整的授权流程（可能包含多个授权页面）
            # 流程：Authorization requested → Allow access → 成功页面
            if complete_authorization_flow(page, max_attempts=5):
                return LoginResult(True, "授权成功", email=credentials.email, password=credentials.password)
            
            final_url = page.url
            error = check_for_errors(page, strict=False)
            if error:
                return LoginResult(False, f"最终检查发现错误: {error}", "BLOCKED")
            
            return LoginResult(False, f"授权流程未完成，当前 URL: {final_url}", "INCOMPLETE")
            
    except Exception as e:
        return LoginResult(False, f"发生异常: {str(e)}", "EXCEPTION")


def wait_for_page_ready(page: Page, timeout: int = 30000) -> None:
    """等待页面完全加载"""
    try:
        # 等待网络空闲
        page.wait_for_load_state("networkidle", timeout=timeout)
    except:
        pass
    
    try:
        # 等待 DOM 加载完成
        page.wait_for_load_state("domcontentloaded", timeout=5000)
    except:
        pass
    
    # 额外等待动态内容
    random_delay(2000, 3000)


def register_with_camoufox(
    verification_url: str,
    reg_options: RegistrationOptions,
    headless: bool = False,
    proxy: Optional[str] = None,
    timeout_ms: int = 180000  # 增加到 3 分钟
) -> LoginResult:
    """
    使用 Camoufox 完成 Amazon 设备授权注册。
    """
    print(f"[PROGRESS] init: 正在初始化浏览器...")
    print(f"[*] 启动 Camoufox 浏览器（注册模式）...")
    print(f"[*] 验证链接: {verification_url}")
    
    # 初始化邮箱客户端
    mail_client = GPTMailClient(
        base_url=reg_options.gptmail_base_url,
        api_key=reg_options.gptmail_api_key,
        proxy=proxy
    )
    
    # 生成邮箱
    print(f"[PROGRESS] create_email: 正在生成临时邮箱...")
    email = mail_client.generate_email(
        prefix=reg_options.email_prefix,
        domain=reg_options.email_domain
    )
    print(f"[+] 生成临时邮箱: {email}")
    print(f"[PROGRESS] create_email: 临时邮箱已生成: {email}")
    
    # 处理密码：验证或自动生成
    password = reg_options.password
    if password:
        # 验证用户提供的密码格式
        is_valid, error_msg = validate_password(password)
        if not is_valid:
            print(f"[!] 密码格式不符合要求: {error_msg}")
            print("[*] 自动生成符合要求的密码...")
            password = generate_secure_password(12)
            print(f"[+] 生成密码: {password}")
    else:
        # 未提供密码，自动生成
        password = generate_secure_password(12)
        print(f"[+] 自动生成密码: {password}")
    
    display_name = reg_options.full_name or generate_display_name()
    
    config = {
        "headless": headless,
        "geoip": True,  # 启用地理位置伪装
        "humanize": True,  # 启用人类化鼠标移动
        "window": (1280, 800),  # 窗口大小（元组格式）
        "locale": "en-US",  # 使用英文界面避免乱码
    }
    if proxy:
        # 代理格式: http://user:pass@host:port 或 http://host:port
        config["proxy"] = {"server": proxy}
    
    try:
        with Camoufox(**config) as browser:
            page = browser.new_page()
            page.set_default_timeout(timeout_ms)
            
            print("[PROGRESS] navigate: 正在打开验证链接...")
            print("[*] 正在打开验证链接...")
            page.goto(verification_url, wait_until="domcontentloaded")
            
            # 等待页面完全加载
            print("[*] 等待页面加载...")
            wait_for_page_ready(page, 30000)
            random_delay(3000, 5000)  # 额外等待
            
            # 处理 Cookie 同意弹窗（如果存在）
            handle_cookie_consent(page)
            random_delay(500, 1000)
            
            # 检查是否有 CAPTCHA
            if check_for_captcha(page):
                print("[!] 检测到 CAPTCHA，尝试等待...")
                random_delay(5000, 8000)
            
            error = check_for_errors(page, strict=False)  # 非严格模式
            if error:
                return LoginResult(False, f"页面加载后检测到错误: {error}", "BLOCKED")
            
            # 模拟人类浏览行为（重要！）
            simulate_human_behavior(page)
            random_delay(1000, 2000)
            
            # 1. 输入邮箱（增加重试）
            print("[PROGRESS] fill_email: 正在查找邮箱输入框...")
            print("[*] 正在查找邮箱输入框...")
            email_found = False
            for attempt in range(3):
                if find_and_fill_email(page, email):
                    email_found = True
                    break
                print(f"[!] 第 {attempt + 1} 次尝试未找到邮箱输入框，等待后重试...")
                random_delay(3000, 5000)
                wait_for_page_ready(page, 10000)
            
            if not email_found:
                # 保存截图用于调试
                try:
                    page.screenshot(path="debug_email_not_found.png")
                    print("[!] 已保存调试截图: debug_email_not_found.png")
                except:
                    pass
                return LoginResult(False, "未找到邮箱输入框", "EMAIL_INPUT_NOT_FOUND")
            
            random_delay(2000, 4000)
            
            # 等待页面跳转
            print("[*] 等待页面响应...")
            wait_for_page_ready(page, 15000)
            random_delay(3000, 5000)
            
            error = check_for_errors(page, strict=False)
            if error:
                return LoginResult(False, f"输入邮箱后检测到错误: {error}", "BLOCKED")
            
            # 打印当前页面结构
            print("[*] 分析邮箱提交后的页面...")
            print_page_structure(page)
            
            # 2. 检测是否进入注册流程（多次尝试）
            print("[PROGRESS] submit_email: 检测是否进入注册流程...")
            print("[*] 检测是否进入注册流程...")
            is_registration = False
            for attempt in range(3):
                if detect_registration_page(page):
                    is_registration = True
                    break
                print(f"[!] 第 {attempt + 1} 次检测未发现注册页面，等待...")
                random_delay(2000, 3000)
            
            if not is_registration:
                try:
                    page.screenshot(path="debug_not_registration.png")
                    print("[!] 已保存调试截图: debug_not_registration.png")
                except:
                    pass
                return LoginResult(False, "未进入注册页面，邮箱可能已被注册", "ALREADY_REGISTERED")
            
            print("[+] 检测到注册页面")
            
            # 3. 填写注册表单
            print("[PROGRESS] fill_profile: 正在填写个人信息...")
            if not fill_registration_form(page, display_name, password):
                try:
                    page.screenshot(path="debug_form_failed.png")
                    print("[!] 已保存调试截图: debug_form_failed.png")
                except:
                    pass
                return LoginResult(False, "填写注册表单失败", "FORM_FILL_FAILED")
            
            # 等待页面处理
            print("[*] 等待表单提交...")
            wait_for_page_ready(page, 15000)
            random_delay(3000, 5000)
            
            # 4. 等待验证码页面
            print("[*] 等待验证码页面...")
            random_delay(3000, 5000)
            
            # 打印验证码页面结构
            print("[*] 分析验证码页面...")
            print_page_structure(page)
            
            # 5. 获取验证码
            print("[PROGRESS] verify_email: 正在等待验证码邮件...")
            try:
                code = mail_client.wait_for_verification_code(
                    email=email,
                    timeout_ms=120000,
                    poll_interval_ms=3000
                )
            except TimeoutError as e:
                return LoginResult(False, str(e), "VERIFICATION_TIMEOUT")
            
            # 6. 填写验证码
            print("[PROGRESS] verify_email: 正在填写验证码...")
            if not fill_verification_code(page, code):
                try:
                    page.screenshot(path="debug_code_failed.png")
                    print("[!] 已保存调试截图: debug_code_failed.png")
                except:
                    pass
                return LoginResult(False, "填写验证码失败", "CODE_FILL_FAILED")
            
            # 等待页面处理
            print("[*] 等待验证码处理...")
            wait_for_page_ready(page, 15000)
            random_delay(3000, 5000)
            
            # 7. 检查是否需要设置密码（AWS 流程：邮箱→姓名→验证码→密码）
            # 先处理 Cookie 弹窗（可能会挡住密码输入框的检测）
            print("[*] 检查是否需要设置密码...")
            handle_cookie_consent(page)
            random_delay(500, 1000)
            
            # 多次尝试检测密码页面（页面可能加载较慢）
            password_found = False
            for pwd_attempt in range(5):
                print(f"[*] 检测密码页面 ({pwd_attempt + 1}/5)...")
                
                # 方法1: 使用综合检测函数（基于页面标题、placeholder、元素类型）
                if detect_password_page(page):
                    password_found = True
                    print("[+] 综合检测确认：当前是密码设置页面")
                    break
                
                # 方法2: 等待特定选择器出现（AWS Builder ID 页面特征）
                aws_password_selectors = [
                    'input[placeholder="Enter password"]',
                    'input[placeholder="Re-enter password"]',
                    'input[type="password"]',
                ]
                
                for selector in aws_password_selectors:
                    try:
                        page.wait_for_selector(selector, state='attached', timeout=3000)
                        locator = page.locator(selector).first
                        
                        # 使用 bounding_box 检测（无头模式更可靠）
                        try:
                            box = locator.bounding_box()
                            if box and box.get('width', 0) > 0 and box.get('height', 0) > 0:
                                password_found = True
                                print(f"[+] 检测到密码输入框: {selector} (尺寸: {box['width']:.0f}x{box['height']:.0f})")
                                break
                        except:
                            pass
                        
                        # 回退到 is_visible
                        if locator.is_visible(timeout=1000):
                            password_found = True
                            print(f"[+] 检测到密码输入框 (is_visible): {selector}")
                            break
                    except PlaywrightTimeout:
                        continue
                    except Exception as e:
                        continue
                
                if password_found:
                    break
                
                # 打印页面状态用于调试
                if pwd_attempt == 2:  # 第3次尝试时打印调试信息
                    print(f"[DEBUG] 当前 URL: {page.url}")
                    try:
                        # 检查各种密码相关元素
                        for sel in ['input[type="password"]', 'input[placeholder*="password" i]']:
                            count = page.locator(sel).count()
                            if count > 0:
                                print(f"[DEBUG] 选择器 '{sel}' 匹配 {count} 个元素")
                                for i in range(min(count, 3)):
                                    try:
                                        inp = page.locator(sel).nth(i)
                                        placeholder = inp.get_attribute('placeholder') or ''
                                        box = inp.bounding_box()
                                        print(f"[DEBUG]   [{i}] placeholder='{placeholder}', box={box}")
                                    except:
                                        pass
                    except Exception as debug_err:
                        print(f"[DEBUG] 调试信息获取失败: {debug_err}")
                
                # 等待后重试
                if pwd_attempt < 4:
                    random_delay(3000, 5000)
                    wait_for_page_ready(page, 10000)
            
            if password_found:
                print("[PROGRESS] fill_password: 正在设置密码...")
                if not fill_password_step(page, password):
                    try:
                        page.screenshot(path="debug_password_failed.png")
                        print("[!] 已保存调试截图: debug_password_failed.png")
                    except:
                        pass
                    return LoginResult(False, "填写密码失败", "PASSWORD_FILL_FAILED")
                
                wait_for_page_ready(page, 15000)
                random_delay(3000, 5000)
            else:
                print("[!] 未检测到密码输入框，可能页面结构不同")
            
            # 8. 完成完整的授权流程（可能包含多个授权页面）
            # 流程：Authorization requested → Allow access → 成功页面
            # 注册流程较慢，增加尝试次数
            print("[PROGRESS] authorize: 正在完成设备授权...")
            if complete_authorization_flow(page, max_attempts=15):
                print("[PROGRESS] done: 注册并授权成功!")
                return LoginResult(True, "注册并授权成功", email=email, password=password)
            
            final_url = page.url
            error = check_for_errors(page, strict=False)
            if error:
                return LoginResult(False, f"最终检查发现错误: {error}", "BLOCKED")
            
            return LoginResult(False, f"注册流程未完成，当前 URL: {final_url}", "INCOMPLETE", email=email, password=password)
            
    except Exception as e:
        return LoginResult(False, f"发生异常: {str(e)}", "EXCEPTION")


def main():
    parser = argparse.ArgumentParser(description="使用 Camoufox 完成 Amazon 设备授权登录/注册")
    parser.add_argument("--url", required=True, help="设备验证链接")
    parser.add_argument("--mode", choices=["login", "register"], default="login", help="模式: login 或 register")
    
    # 登录模式参数
    parser.add_argument("--email", help="AWS 邮箱（登录模式必需）")
    parser.add_argument("--password", help="AWS 密码（登录模式必需，注册模式可选-不提供则自动生成）")
    parser.add_argument("--mfa-secret", help="MFA 密钥 (可选)")
    
    # 注册模式参数
    parser.add_argument("--gptmail-url", help="GPTMail API 地址（注册模式必需）")
    parser.add_argument("--gptmail-key", help="GPTMail API 密钥（注册模式必需）")
    parser.add_argument("--email-prefix", help="邮箱前缀（可选）")
    parser.add_argument("--email-domain", help="邮箱域名（可选）")
    parser.add_argument("--full-name", help="显示名称（可选）")
    
    # 通用参数
    parser.add_argument("--proxy", help="代理服务器 (格式: http://host:port)")
    parser.add_argument("--headless", action="store_true", help="无头模式")
    parser.add_argument("--json", action="store_true", help="JSON 格式输出")
    
    args = parser.parse_args()
    
    if args.mode == "login":
        if not args.email:
            parser.error("登录模式需要 --email 参数")
        if not args.password:
            parser.error("登录模式需要 --password 参数")
        
        credentials = Credentials(
            email=args.email,
            password=args.password,
            mfa_secret=args.mfa_secret
        )
        
        result = login_with_camoufox(
            verification_url=args.url,
            credentials=credentials,
            headless=args.headless,
            proxy=args.proxy
        )
    else:
        # 注册模式
        if not args.gptmail_url or not args.gptmail_key:
            parser.error("注册模式需要 --gptmail-url 和 --gptmail-key 参数")
        
        reg_options = RegistrationOptions(
            gptmail_base_url=args.gptmail_url,
            gptmail_api_key=args.gptmail_key,
            password=args.password,  # 可选，不提供则自动生成
            email_prefix=args.email_prefix,
            email_domain=args.email_domain,
            full_name=args.full_name
        )
        
        result = register_with_camoufox(
            verification_url=args.url,
            reg_options=reg_options,
            headless=args.headless,
            proxy=args.proxy
        )
    
    if args.json:
        output = {
            "success": result.success,
            "message": result.message,
            "error_code": result.error_code,
            "email": result.email,
            "password": result.password
        }
        print(json.dumps(output))
    else:
        if result.success:
            print(f"\n✅ {result.message}")
            if result.email:
                print(f"   邮箱: {result.email}")
            if result.password:
                print(f"   密码: {result.password}")
        else:
            print(f"\n❌ {result.message}")
            if result.error_code:
                print(f"   错误码: {result.error_code}")
    
    sys.exit(0 if result.success else 1)


if __name__ == "__main__":
    main()
