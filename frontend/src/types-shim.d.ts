// react-syntax-highlighter 缺少类型定义，简单声明
declare module "react-syntax-highlighter" {
  import type { ComponentType, ReactNode } from "react"
  export const Prism: ComponentType<{
    language?: string
    style?: any
    customStyle?: any
    codeTagProps?: any
    children?: ReactNode
  }>
}

declare module "react-syntax-highlighter/dist/esm/styles/prism" {
  const styles: Record<string, any>
  export const oneLight: any
  export default styles
}
