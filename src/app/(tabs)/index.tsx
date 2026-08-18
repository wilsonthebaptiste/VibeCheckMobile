import { Link } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

export default function MapScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>Map Screen (placeholder)</Text>
      <Link href="/venue/5" style={styles.link}>
        <Text style={styles.linkText}>Go to Venue 5 (test link)</Text>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    fontSize: 18,
  },
  link: {
    marginTop: 20,
  },
  linkText: {
    fontSize: 16,
    color: '#0274DF',
    textDecorationLine: 'underline',
  },
});