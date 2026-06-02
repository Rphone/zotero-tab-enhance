# Tab Enhance for Zotero
[![zotero target version](https://img.shields.io/badge/Zotero-7-green?style=flat-square&logo=zotero&logoColor=CC2936)](https://www.zotero.org)
[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-square&logo=github)](https://github.com/windingwind/zotero-plugin-template)
![Downloads latest release](https://img.shields.io/github/downloads/Rphone/zotero-tab-enhance/latest/total?color=yellow)

简体中文 | [English](doc/README_en.md)

Tab Enhance是一个Zotero 插件，为Zotero的标签页添加了更多便捷功能。

## 主要功能

### 水平标签页的右键菜单增强：
- **在文件系统中显示**: 右键点击文档标签页，可以快速在文件系统中定位当前文档(避免从Zotero item 再到 文件系统 的两步跳转)
- **重新载入标签页**：右键点击文档标签页，可以重新载入标签页(方便同步外部编辑器对文档的修改)
- **快速引用**：右键点击文档标签页，可以快速引用标签页对应的文章(引用格式遵循Zotero的用户设置)

### 侧边栏
- **垂直标签页**：在侧边栏显示标签页，方便在多个标签页之间切换
- **标签页分组**：可以将相关的标签页分组管理
- **标签页搜索**：提供标签页搜索功能，快速定位需要的标签页

## 安装

1. 从[Releases页面](https://github.com/Rphone/zotero-tab-enhance/releases)下载最新的`.xpi`文件
2. 在Zotero中，选择`工具 -> 插件 -> ⚙️ -> Install Plugin From File`，然后选择下载的XPI文件

## 兼容性

- 需要Zotero 7.0或更高版本
- 兼容Zotero 7.0-7.1.\*

## 功能


### 标签页侧边栏
  为zotero添加一个侧边栏，自动同步原生标签页的状态，提供标签页分组、搜索等功能。
  标签关闭不会将其从侧边栏移除，而是会将其状态标记为已关闭，方便管理和恢复标签页。
 #### 功能截图
![sidebar](assets/sidebar.gif)
### 标签页分组与管理
 为侧边栏中的标签页提供分组功能，可以将相关的标签页放在同一组中，方便管理和切换。
 分组支持展开和收起，可以根据需要调整界面布局。
 注意:分组保持在侧边栏中置顶。

 #### 功能截图
![group](assets/group.gif)

### 标签页跳转资源管理器

1. 打开一个PDF或其他文档在Zotero中
2. 右键点击该文档的标签页
3. 选择"在文件管理器中显示"选项

   #### 功能截图

![show_in_filesystem](assets/show_in_filesystem.gif)

### 标签重载

1. 打开一个PDF或其他文档在Zotero中
2. 右键点击该文档的标签页
3. 选择"重新加载标签页"选项

   #### 功能截图

   ![reload1](assets/reload_1.gif)

### 获取引用 

1. 打开一个PDF或其他文档在Zotero中
2. 右键点击该文档的标签页
3. 选择"复制引用到剪切板"选项
4. 引用格式遵循 ` 编辑-> 设置 -> 导出` 的配置

   #### 功能截图
   ![copy_ref](assets/copy_ref.gif)



## 参与开发
如果你对这个项目感兴趣，并且想要参与开发，欢迎提交PR, 本项目已经包含AGENTS.md文件，为AI编码代理提供了简单的开发指南和项目结构说明，便于快速上手开发。
## 感谢与反馈

感谢[Zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)项目提供的插件开发模板，极大地简化了插件的开发流程。

感谢[Ethereal Style](https://github.com/MuiseDestiny/zotero-style),[bilibili](https://www.bilibili.com/video/BV1rwcBzbEVG/) 讲解和展示的的侧边栏实现思路，有能力的同学可以开通pro会员支持一下该作者。

Microsoft Edge 的标签页分组功能为插件的标签页分组功能提供了很好的样式设计参考。


本人非经验丰富的JS/TS和Zotero开发者，因此插件难免会碰到潜在的bug。代码在AI的帮助下编写和优化，但仍可能存在问题。如果你在使用过程中遇到任何问题，或者有任何建议和改进意见，欢迎随时提出[Issues](https://github.com/Rphone/zotero-tab-enhance/issues)。

## 许可

该项目基于[AGPLv3](https://www.gnu.org/licenses/agpl-3.0.html)许可发布。
