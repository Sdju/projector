import { defineComponent, type PropType, type Slot } from "vue";

/** Keep the outlet identity stable when its owner's slot function changes on a render. */
export default defineComponent({
  props: {
    render: { type: Function as PropType<Slot>, required: true },
    args: { type: Object as PropType<Record<string, unknown>>, required: true },
  },
  setup: (props) => () => props.render(props.args),
});
